"""剖面分析：剖面線與各種管線的交點（位置、埋深、斷面尺寸、屬性）。

剖面線是兩點直線（WGS84 經緯度），在 EPSG:3826 計算：
- dist：交點距剖面線起點的水平距離（公尺）
- depth：交點的管頂埋深（公尺，地表 = 0）＝ 起點埋深 →終點埋深 依交點在管線上的水平比例內插（與 3D 埋深模式相同）
  缺一端用另一端；兩端都缺回傳 null。超過 PIPE_MAX_DEPTH 截斷並標 clamped（同 3D 的 PIPE3D_MAX_DEPTH）。
- w／h：斷面寬、高（公尺，依 size_unit 換算；h 為 null 表示圓管）
管線與剖面線平行重疊時交點是一段線，取該段中點（overlap = true）。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from psycopg import sql

from ..db import pool
from ..layers import PIPE_LAYERS
from ..pipes3d_tiles import DIA_M, HEIGHT_M

router = APIRouter()

PROFILE_MAX_LENGTH = 1000  # 剖面線長度上限（公尺）
PROFILE_MAX_PIPES = 500  # 回傳交點上限（全部種類合計）
PIPE_MAX_DEPTH = 30  # 埋深異常值截斷（公尺），與前端 PIPE3D_MAX_DEPTH 一致

_QUERY = f"""
    WITH s AS (
        SELECT ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint(%(x1)s, %(y1)s), ST_MakePoint(%(x2)s, %(y2)s)), 4326), 3826) AS g
    ), x AS (
        SELECT p.gid, p.pipe_no, p.material, p.mgmt_unit, p.dia_width, p.dia_height, p.size_unit, p.pipe_count,
               p.start_dep, p.end_dep,
               round(({DIA_M})::numeric, 4)::float8 AS w, round(({HEIGHT_M})::numeric, 4)::float8 AS h,
               ST_Force2D(p.geom) AS pg, (ST_Dump(ST_Intersection(ST_Force2D(p.geom), s.g))).geom AS ig, s.g AS sg
        FROM {{tbl}} p, s
        WHERE ST_Intersects(p.geom, s.g)
    ), pt AS (
        SELECT x.*, GeometryType(ig) <> 'POINT' AS overlap,
               CASE WHEN GeometryType(ig) = 'POINT' THEN ig ELSE ST_LineInterpolatePoint(ig, 0.5) END AS ip
        FROM x
        WHERE GeometryType(ig) IN ('POINT', 'LINESTRING')
    )
    SELECT gid, pipe_no, material, mgmt_unit, dia_width, dia_height, size_unit, pipe_count, start_dep, end_dep, w, h,
           overlap,
           ST_LineLocatePoint(sg, ip) * ST_Length(sg) AS dist,
           ST_LineLocatePoint(pg, ip) AS frac,
           ST_X(ST_Transform(ip, 4326)) AS lng, ST_Y(ST_Transform(ip, 4326)) AS lat
    FROM pt
    ORDER BY dist
    LIMIT %(limit)s
"""


def _depth(sd: float | None, ed: float | None, frac: float) -> tuple[float | None, bool]:
    """交點管頂埋深與是否截斷。埋深 ≤ 0 或 null 視為缺值。"""
    ok_s = sd is not None and sd > 0
    ok_e = ed is not None and ed > 0
    if not ok_s and not ok_e:
        return None, False
    a = sd if ok_s else ed
    b = ed if ok_e else sd
    d = a + (b - a) * frac
    return (PIPE_MAX_DEPTH, True) if d > PIPE_MAX_DEPTH else (round(d, 3), False)


@router.get("/api/profile")
def profile(
    line: str = Query(..., description="剖面線起終點 lng1,lat1,lng2,lat2（EPSG:4326）"),
    layers: str = Query(",".join(PIPE_LAYERS), description="管線資料表，逗號分隔"),
) -> dict:
    """剖面線與管線的交點，依距離排序。"""
    try:
        x1, y1, x2, y2 = (float(v) for v in line.split(","))
    except ValueError:
        raise HTTPException(422, "line 格式應為 lng1,lat1,lng2,lat2")
    names = [n for n in dict.fromkeys(layers.split(",")) if n]
    bad = [n for n in names if n not in PIPE_LAYERS]
    if bad:
        raise HTTPException(422, f"layers 只能是 {', '.join(PIPE_LAYERS)}")

    params = {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
    with pool.connection() as conn:
        length = conn.execute(
            "SELECT ST_Length(ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint(%(x1)s, %(y1)s), ST_MakePoint(%(x2)s, %(y2)s)), 4326), 3826)) AS m",
            params,
        ).fetchone()["m"]
        if length <= 0:
            raise HTTPException(422, "剖面線起點與終點不可相同")
        if length > PROFILE_MAX_LENGTH:
            raise HTTPException(422, f"剖面線不可超過 {PROFILE_MAX_LENGTH} 公尺（目前 {length:.0f} 公尺）")

        pipes: list[dict] = []
        truncated = False
        for name in names:
            left = PROFILE_MAX_PIPES - len(pipes)
            if left <= 0:
                truncated = True
                break
            rows = conn.execute(
                sql.SQL(_QUERY).format(tbl=sql.Identifier(name)), {**params, "limit": left + 1}
            ).fetchall()
            if len(rows) > left:
                truncated = True
                rows = rows[:left]
            for r in rows:
                depth, clamped = _depth(r["start_dep"], r["end_dep"], r["frac"])
                pipes.append({
                    "layer": name,
                    "gid": r["gid"],
                    "pipe_no": r["pipe_no"],
                    "material": r["material"],
                    "mgmt_unit": r["mgmt_unit"],
                    "dia_width": r["dia_width"],
                    "dia_height": r["dia_height"],
                    "size_unit": r["size_unit"],
                    "n": r["pipe_count"],
                    "w": r["w"],
                    "h": r["h"],
                    "dist": round(r["dist"], 3),
                    "depth": depth,
                    "clamped": clamped,
                    "overlap": r["overlap"],
                    "lng": r["lng"],
                    "lat": r["lat"],
                })
    pipes.sort(key=lambda p: p["dist"])
    return {"length": round(length, 3), "truncated": truncated, "pipes": pipes}
