"""台北市公共管線 API。

啟動（在 8-Project\\api）：
    uv run uvicorn app.main:app --reload --port 8000

前端開發時經 Vite 代理 /api → http://127.0.0.1:8000。
2D 向量圖磚由 Martin 提供；這裡負責 MVT 做不到的部分（帶 Z 值的 3D 幾何、查詢、統計）。
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg import sql

from .db import pool
from .routers import geocode


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="台北市公共管線 API", lifespan=lifespan)
app.include_router(geocode.router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    with pool.connection() as conn:
        row = conn.execute("SELECT postgis_lib_version() AS postgis, count(*) AS pipes FROM utl_pipe").fetchone()
    return {"status": "ok", **row}


# 可查詢的管線資料表（一種管線一張表，名稱與 Martin 圖磚 source 相同）。只接受這裡列出的名稱。
PIPE_LAYERS = {
    "utl_pipe": "污水下水道管線（類別碼 8040101）",
    "utl_tel_pipe": "一般電信系統管線（類別碼 8010101）",
    "utl_cable_duct": "纜線管路（綜合管線，類別碼 8080401）",
    "utl_catv_pipe": "有線電視系統管線（電信，類別碼 8010401）",
    "utl_police_pipe": "警訊系統管線（電信，類別碼 8010301）",
    "utl_tel06_pipe": "電信小類 06 管線（類別碼 8010601，小類名稱待確認）",
}
LayerParam = Query("utl_pipe", description="管線資料表：" + "、".join(PIPE_LAYERS))


def _layer_table(layer: str) -> sql.Identifier:
    if layer not in PIPE_LAYERS:
        raise HTTPException(422, f"layer 只能是 {', '.join(PIPE_LAYERS)}")
    return sql.Identifier(layer)


@app.get("/api/layers")
def layers() -> list[dict]:
    """可用的管線資料表。"""
    return [{"layer": k, "name": v} for k, v in PIPE_LAYERS.items()]


@app.get("/api/pipes/{gid}")
def pipe_detail(gid: int, layer: str = LayerParam) -> dict:
    """單一管線：全部屬性＋保留 Z 值的 GeoJSON 幾何（EPSG:4326）。"""
    query = sql.SQL("""
        SELECT to_jsonb(p) - 'geom' - 'gid' AS props,
               ST_AsGeoJSON(ST_Transform(p.geom, 4326), 8) AS geometry
        FROM {tbl} p WHERE gid = %s
    """).format(tbl=_layer_table(layer))
    with pool.connection() as conn:
        row = conn.execute(query, [gid]).fetchone()
    if not row:
        raise HTTPException(404, f"找不到管線 {layer} gid={gid}")
    return {"type": "Feature", "id": gid, "properties": row["props"], "geometry": json.loads(row["geometry"])}


# 管徑換算成公尺：size_unit 0=mm、1=英吋、2=cm、3=m（依資料分布推定：0 中位數 200、1 為 1~12、2 為 10~30、3 為 0.1~0.25）
_UNIT_M = "CASE size_unit WHEN 1 THEN 0.0254 WHEN 2 THEN 0.01 WHEN 3 THEN 1 ELSE 0.001 END"
_DIA_M = f"dia_width * {_UNIT_M}"
# 管徑高度（公尺）：0 或缺值表示圓管（只有寬度）→ null
_HEIGHT_M = f"CASE WHEN dia_height > 0 THEN dia_height * {_UNIT_M} END"
PIPES3D_MAX_SPAN = 0.1  # bbox 最大經緯度跨度（約 10km），避免整個城市一次查
PIPES3D_MAX_LIMIT = 10000


@app.get("/api/pipes3d")
def pipes_3d(
    bbox: str = Query(..., description="west,south,east,north（EPSG:4326）"),
    limit: int = Query(5000, ge=1, le=PIPES3D_MAX_LIMIT),
    layer: str = LayerParam,
) -> dict:
    """3D 用的精簡管線資料：範圍內的管線，離 bbox 中心近的優先，最多 limit 筆。

    coords 為 [lng, lat, z]（z = 原始 Z 值），dia 為管徑／寬度（公尺），h 為高度（公尺，圓管為 null），
    n 為共管條數，sd/ed 為起／終點埋設深度（公尺）。
    """
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox 格式應為 west,south,east,north")
    tbl = _layer_table(layer)
    if not (w < e and s < n):
        raise HTTPException(422, "bbox 範圍不正確")
    if e - w > PIPES3D_MAX_SPAN or n - s > PIPES3D_MAX_SPAN:
        raise HTTPException(422, f"bbox 跨度不可超過 {PIPES3D_MAX_SPAN} 度")

    # 整包 JSON 由 PostgreSQL 組好、原樣回傳，省掉 Python 解析再序列化（5000 筆約省一半時間，見 2-Tasks/1-效能評估.md）。
    # 多取 1 筆（limit + 1）只用來判斷 truncated。
    query = sql.SQL(f"""
        WITH q AS (
            SELECT ST_Transform(ST_MakeEnvelope(%(w)s, %(s)s, %(e)s, %(n)s, 4326), 3826) AS box,
                   ST_Transform(ST_SetSRID(ST_MakePoint((%(w)s + %(e)s) / 2, (%(s)s + %(n)s) / 2), 4326), 3826) AS c
        ), r AS (
            SELECT p.gid, p.material AS mat, round(({_DIA_M})::numeric, 4)::float8 AS dia,
                   round(({_HEIGHT_M})::numeric, 4)::float8 AS h, p.pipe_count AS n,
                   p.start_dep AS sd, p.end_dep AS ed, p.geom,
                   row_number() OVER (ORDER BY p.geom <-> q.c) AS rn
            FROM {{tbl}} p, q
            WHERE p.geom && q.box
            ORDER BY p.geom <-> q.c
            LIMIT %(limit)s + 1
        )
        SELECT json_build_object(
            'truncated', count(*) > %(limit)s,
            'pipes', coalesce(json_agg(json_build_object(
                'gid', gid, 'mat', mat, 'dia', dia, 'h', h, 'n', n, 'sd', sd, 'ed', ed,
                'coords', ST_AsGeoJSON(ST_Transform(geom, 4326), 8)::json -> 'coordinates'
            ) ORDER BY rn) FILTER (WHERE rn <= %(limit)s), '[]'::json)
        )::text
        FROM r
    """).format(tbl=tbl)
    with pool.connection() as conn:
        body = conn.execute(query, {"w": w, "s": s, "e": e, "n": n, "limit": limit}).fetchone()
    return Response(next(iter(body.values())), media_type="application/json")
