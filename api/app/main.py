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

from .db import pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="台北市公共管線 API", lifespan=lifespan)
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


@app.get("/api/pipes/{gid}")
def pipe_detail(gid: int) -> dict:
    """單一管線：全部屬性＋保留 Z 值的 GeoJSON 幾何（EPSG:4326）。"""
    sql = """
        SELECT to_jsonb(p) - 'geom' - 'gid' AS props,
               ST_AsGeoJSON(ST_Transform(p.geom, 4326), 8) AS geometry
        FROM utl_pipe p WHERE gid = %s
    """
    with pool.connection() as conn:
        row = conn.execute(sql, [gid]).fetchone()
    if not row:
        raise HTTPException(404, f"找不到管線 gid={gid}")
    return {"type": "Feature", "id": gid, "properties": row["props"], "geometry": json.loads(row["geometry"])}


# 管徑換算成公尺：size_unit 0=mm、1=英吋、2=cm、3=m（依資料分布推定：0 中位數 200、1 為 1~12、2 為 10~30、3 為 0.1~0.25）
_DIA_M = "dia_width * CASE size_unit WHEN 1 THEN 0.0254 WHEN 2 THEN 0.01 WHEN 3 THEN 1 ELSE 0.001 END"
PIPES3D_MAX_SPAN = 0.1  # bbox 最大經緯度跨度（約 10km），避免整個城市一次查
PIPES3D_MAX_LIMIT = 10000


@app.get("/api/pipes3d")
def pipes_3d(
    bbox: str = Query(..., description="west,south,east,north（EPSG:4326）"),
    limit: int = Query(5000, ge=1, le=PIPES3D_MAX_LIMIT),
) -> dict:
    """3D 用的精簡管線資料：範圍內的管線，離 bbox 中心近的優先，最多 limit 筆。

    coords 為 [lng, lat, z]（z = 原始 Z 值），dia 為管徑（公尺），sd/ed 為起／終點埋設深度（公尺）。
    """
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox 格式應為 west,south,east,north")
    if not (w < e and s < n):
        raise HTTPException(422, "bbox 範圍不正確")
    if e - w > PIPES3D_MAX_SPAN or n - s > PIPES3D_MAX_SPAN:
        raise HTTPException(422, f"bbox 跨度不可超過 {PIPES3D_MAX_SPAN} 度")

    # 整包 JSON 由 PostgreSQL 組好、原樣回傳，省掉 Python 解析再序列化（5000 筆約省一半時間，見 2-Tasks/1-效能評估.md）。
    # 多取 1 筆（limit + 1）只用來判斷 truncated。
    sql = f"""
        WITH q AS (
            SELECT ST_Transform(ST_MakeEnvelope(%(w)s, %(s)s, %(e)s, %(n)s, 4326), 3826) AS box,
                   ST_Transform(ST_SetSRID(ST_MakePoint((%(w)s + %(e)s) / 2, (%(s)s + %(n)s) / 2), 4326), 3826) AS c
        ), r AS (
            SELECT p.gid, p.material AS mat, round(({_DIA_M})::numeric, 4)::float8 AS dia,
                   p.start_dep AS sd, p.end_dep AS ed, p.geom,
                   row_number() OVER (ORDER BY p.geom <-> q.c) AS rn
            FROM utl_pipe p, q
            WHERE p.geom && q.box
            ORDER BY p.geom <-> q.c
            LIMIT %(limit)s + 1
        )
        SELECT json_build_object(
            'truncated', count(*) > %(limit)s,
            'pipes', coalesce(json_agg(json_build_object(
                'gid', gid, 'mat', mat, 'dia', dia, 'sd', sd, 'ed', ed,
                'coords', ST_AsGeoJSON(ST_Transform(geom, 4326), 8)::json -> 'coordinates'
            ) ORDER BY rn) FILTER (WHERE rn <= %(limit)s), '[]'::json)
        )::text
        FROM r
    """
    with pool.connection() as conn:
        body = conn.execute(sql, {"w": w, "s": s, "e": e, "n": n, "limit": limit}).fetchone()
    return Response(next(iter(body.values())), media_type="application/json")
