"""管線衝突檢核：規劃管線（使用者畫的折線＋管徑＋起終點管頂埋深）與既有管線的淨距。

做法（EPSG:3826，深度以地表 = 0、往下為負的 Z 表示）：
1. 規劃管線、既有管線各自做成「管中心」3D 折線：每個頂點的管頂埋深依頂點在線上的水平比例，
   由起點埋深內插到終點埋深（與 3D 埋深模式、剖面分析相同），再往下半個管高。
2. 2D 粗篩：既有管線在規劃管線 REACH 範圍內（用空間索引）。
3. ST_3DShortestLine 取兩條中心線最接近的兩點，分成水平、垂直分量：
   水平淨距 = 水平中心距 − 兩管半寬；垂直淨距 = |高差| − 兩管半高。
   兩者都 < 0 → 重疊（overlap）；兩者都 < 檢核淨距 → 淨距不足（near）。
   既有管線埋深缺值 → 只檢水平（2D 最近點），水平淨距 < 檢核淨距 → 埋深缺值（nodepth）。
既有管線斷面同剖面分析／3D：有高度且寬高比 ≤ 10 倍 → 矩形（寬×高外包絡），否則圓管；沒有管徑當 0.1m。
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from psycopg import sql
from pydantic import BaseModel, Field

from ..db import pool
from ..layers import PIPE_LAYERS
from ..pipes3d_tiles import DIA_M, HEIGHT_M

router = APIRouter()

CLASH_MAX_LENGTH = 2000  # 規劃管線長度上限（公尺）
CLASH_MAX_POINTS = 200  # 規劃管線頂點上限
CLASH_MAX_RESULTS = 500  # 回傳衝突上限（全部種類合計）
CLASH_REACH = 3.0  # 粗篩時既有管線半寬的上限估計（公尺），加在規劃半徑＋淨距外
PIPE_MAX_DEPTH = 30  # 埋深異常值截斷（公尺），與剖面分析、前端 PIPE3D_MAX_DEPTH 一致
DEFAULT_DIA = 0.1  # 既有管線沒有管徑時（公尺），與 3D 相同


class ClashRequest(BaseModel):
    line: list[tuple[float, float]] = Field(..., min_length=2, max_length=CLASH_MAX_POINTS, description="規劃管線頂點 [lng, lat]（EPSG:4326）")
    dia: float = Field(..., gt=0, le=5, description="規劃管徑（公尺）")
    start_dep: float = Field(..., ge=0, le=PIPE_MAX_DEPTH, description="起點管頂埋深（公尺）")
    end_dep: float = Field(..., ge=0, le=PIPE_MAX_DEPTH, description="終點管頂埋深（公尺）")
    clearance: float = Field(..., ge=0, le=5, description="檢核淨距（公尺），水平與垂直相同")
    layers: list[str] = Field(default_factory=lambda: list(PIPE_LAYERS))


# 頂點逐一換成 3D（Z = −(管頂埋深 + 半管高)），{dep} 是以 ST_LineLocatePoint 比例 f 表示的埋深式子
def _center3d(line: str, dep: str) -> str:
    return f"""ST_SetSRID(ST_MakeLine(ARRAY(
        SELECT ST_MakePoint(ST_X(v.geom), ST_Y(v.geom), -({dep.replace('{f}', f'ST_LineLocatePoint({line}, v.geom)')}))
        FROM ST_DumpPoints({line}) v ORDER BY v.path)), 3826)"""


_QUERY = f"""
    WITH s AS (
        SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%(line)s), 4326), 3826) AS g
    ), s3 AS (
        SELECT g, ST_Length(g) AS len,
               {_center3d('g', '%(sd)s + (%(ed)s - %(sd)s) * {f} + %(dia)s / 2')} AS g3
        FROM s
    ), c AS (
        SELECT p.gid, p.pipe_no, p.material, p.mgmt_unit, p.dia_width, p.dia_height, p.size_unit, p.pipe_count,
               p.start_dep, p.end_dep, ({DIA_M}) AS w, ({HEIGHT_M}) AS h, ST_Force2D(p.geom) AS pg,
               CASE WHEN p.start_dep > 0 THEN p.start_dep WHEN p.end_dep > 0 THEN p.end_dep END AS da,
               CASE WHEN p.end_dep > 0 THEN p.end_dep WHEN p.start_dep > 0 THEN p.start_dep END AS db
        FROM {{tbl}} p, s3
        WHERE ST_DWithin(p.geom, s3.g, %(reach)s)
    ), d AS (
        SELECT c.*, CASE WHEN w > 0 THEN w ELSE {DEFAULT_DIA} END AS ew FROM c
    ), e AS (
        SELECT d.*, CASE WHEN h > 0 AND h * 10 >= ew AND ew * 10 >= h THEN h ELSE ew END AS eh FROM d
    ), f AS (
        SELECT e.*,
               CASE WHEN da IS NOT NULL THEN
                   {_center3d('pg', f'least(da + (db - da) * {{f}}, {PIPE_MAX_DEPTH}) + eh / 2')}
               END AS eg3
        FROM e
    ), k AS (
        SELECT f.*, s3.g AS sg, s3.len,
               CASE WHEN eg3 IS NULL THEN ST_ShortestLine(s3.g, pg) ELSE ST_3DShortestLine(s3.g3, eg3) END AS sl
        FROM f, s3
    )
    SELECT gid, pipe_no, material, mgmt_unit, dia_width, dia_height, size_unit, pipe_count, start_dep, end_dep,
           w, h, ew, eh, eg3 IS NULL AS nodepth,
           ST_Distance(ST_Force2D(ST_StartPoint(sl)), ST_Force2D(ST_EndPoint(sl))) AS hd,
           CASE WHEN eg3 IS NOT NULL THEN ST_Z(ST_StartPoint(sl)) END AS pz,
           CASE WHEN eg3 IS NOT NULL THEN ST_Z(ST_EndPoint(sl)) END AS ez,
           ST_LineLocatePoint(sg, ST_Force2D(ST_StartPoint(sl))) * len AS dist,
           ST_X(ST_Transform(ST_Force2D(ST_EndPoint(sl)), 4326)) AS lng,
           ST_Y(ST_Transform(ST_Force2D(ST_EndPoint(sl)), 4326)) AS lat
    FROM k
"""

_SEVERITY_ORDER = {"overlap": 0, "near": 1, "nodepth": 2}


def _r(v: float | None, n: int = 3) -> float | None:
    return None if v is None else round(v, n)


@router.post("/api/clash")
def clash(req: ClashRequest) -> dict:
    """規劃管線與既有管線的衝突（重疊／淨距不足／埋深缺值），依嚴重度、距起點排序。"""
    names = [n for n in dict.fromkeys(req.layers) if n]
    bad = [n for n in names if n not in PIPE_LAYERS]
    if bad:
        raise HTTPException(422, f"layers 只能是 {', '.join(PIPE_LAYERS)}")

    geo = json.dumps({"type": "LineString", "coordinates": [list(p) for p in req.line]})
    params = {
        "line": geo,
        "sd": req.start_dep,
        "ed": req.end_dep,
        "dia": req.dia,
        "reach": req.dia / 2 + req.clearance + CLASH_REACH,
    }
    c = req.clearance
    with pool.connection() as conn:
        length = conn.execute(
            "SELECT ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%(line)s), 4326), 3826)) AS m", params
        ).fetchone()["m"]
        if length <= 0:
            raise HTTPException(422, "規劃管線長度為 0")
        if length > CLASH_MAX_LENGTH:
            raise HTTPException(422, f"規劃管線不可超過 {CLASH_MAX_LENGTH} 公尺（目前 {length:.0f} 公尺）")

        clashes: list[dict] = []
        checked = 0
        for name in names:
            rows = conn.execute(sql.SQL(_QUERY).format(tbl=sql.Identifier(name)), params).fetchall()
            checked += len(rows)
            for r in rows:
                hgap = r["hd"] - (req.dia + r["ew"]) / 2
                if r["nodepth"]:
                    vgap = None
                    if hgap >= c:
                        continue
                    severity = "nodepth"
                else:
                    vgap = abs(r["pz"] - r["ez"]) - (req.dia + r["eh"]) / 2
                    if hgap < 0 and vgap < 0:
                        severity = "overlap"
                    elif max(hgap, vgap) < c:
                        severity = "near"
                    else:
                        continue
                exist_top = None if r["nodepth"] else -r["ez"] - r["eh"] / 2
                plan_top = (
                    -r["pz"] - req.dia / 2
                    if not r["nodepth"]
                    else req.start_dep + (req.end_dep - req.start_dep) * (r["dist"] / length)
                )
                clashes.append({
                    "layer": name,
                    "gid": r["gid"],
                    "pipe_no": r["pipe_no"],
                    "material": r["material"],
                    "mgmt_unit": r["mgmt_unit"],
                    "dia_width": r["dia_width"],
                    "dia_height": r["dia_height"],
                    "size_unit": r["size_unit"],
                    "n": r["pipe_count"],
                    "w": _r(r["w"], 4),
                    "h": _r(r["h"], 4),
                    "severity": severity,
                    "h_gap": _r(hgap),
                    "v_gap": _r(vgap),
                    "depth": _r(exist_top),
                    "clamped": exist_top is not None and exist_top >= PIPE_MAX_DEPTH - 1e-6,
                    "plan_depth": _r(plan_top),
                    "dist": _r(r["dist"]),
                    "lng": r["lng"],
                    "lat": r["lat"],
                })
    clashes.sort(key=lambda x: (_SEVERITY_ORDER[x["severity"]], x["dist"]))
    truncated = len(clashes) > CLASH_MAX_RESULTS
    return {
        "length": round(length, 3),
        "checked": checked,
        "truncated": truncated,
        "clashes": clashes[:CLASH_MAX_RESULTS],
    }
