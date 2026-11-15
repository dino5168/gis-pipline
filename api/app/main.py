"""台北市公共管線 API。

啟動（在 8-Project\\api）：
    uv run uvicorn app.main:app --reload --port 8000

前端開發時經 Vite 代理 /api → http://127.0.0.1:8000。
2D 向量圖磚由 Martin 提供；這裡負責 MVT 做不到的部分（帶 Z 值的 3D 幾何、查詢、統計）。
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
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
