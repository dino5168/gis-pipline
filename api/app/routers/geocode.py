"""門牌搜尋定位 /api/geocode（資料：etl/addr2pg.py 匯入的 addr_door、addr_road）。

查詢流程（設計見 2-Tasks/10-定位/2-門牌定位可行性評估.md）：
1. 正規化輸入：全形→半形、臺→台、去空白、去「台北市」、「N段」中文數字→阿拉伯數字、`41-3` → `41之3`。
2. 拆出 區？＋路名＋巷？＋弄？＋號？。輸入只有路名的開頭時列出可能的路名（補全）；
   否則在路名字典找「輸入開頭完全相符」的最長路名；
   找不到（錯字、少打段）再用 trigram 比對路名字典取最像的幾條。
3. 巷／弄／號用 B-tree 精確比對；號碼找不到時列出同巷弄號碼最接近的門牌（exact=false）。
   只打到路名就回傳路段本身（含範圍）＋該路門牌清單，讓使用者繼續打。
4. 拆不出來或都沒結果 → 退回整串 trigram KNN（search_key）。
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from fastapi import APIRouter, Query

from ..db import pool

router = APIRouter()

TOWNS = ["松山區", "信義區", "大安區", "中山區", "中正區", "大同區",
         "萬華區", "文山區", "南港區", "內湖區", "士林區", "北投區"]
FULLWIDTH = str.maketrans("０１２３４５６７８９　－", "0123456789 -")
CN_DIGIT = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 路名之後的部分：巷（數字巷或命名巷，例如 銀光巷）、弄、號（可有臨、之）；號之後（樓層、室）忽略
REST_RE = re.compile(r"^(?:(\d+|[^\d巷弄號]{1,4})巷)?(?:(\d+)弄)?(?:(臨)?(\d+)(?:之(\d+))?號?)?")
# 模糊比對時切出路名：到第一個「N段」為止，沒有段就到第一個數字為止
ROAD_PART_RE = re.compile(r"^(.*?\d+段|[^\d]*)(.*)$")
ROAD_MIN_SIMILARITY = 0.2
KNN_MIN_SIMILARITY = 0.1
ROAD_COMPLETIONS = 8  # 路名補全最多列幾條
DOOR_ZOOM_ROWS = 50  # 只打路名／巷時列出的門牌數上限（再截成 limit）


def normalize(s: str) -> str:
    """與 etl/addr2pg.py 的 normalize() 同一套規則（search_key／road_key），另外處理使用者輸入習慣。"""
    s = s.translate(FULLWIDTH).replace("臺", "台")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"^(台北市|台北)", "", s)
    s = re.sub(r"(\d+)-(\d+)", r"\1之\2", s)
    return re.sub(r"([一二三四五六七八九])段", lambda m: f"{CN_DIGIT[m.group(1)]}段", s)


_roads: list[str] | None = None


def road_keys(conn) -> list[str]:
    """路名字典（約 830 個不重複路名），依長度由長到短，前綴比對時先比到最長的。"""
    global _roads
    if _roads is None:
        rows = conn.execute("SELECT DISTINCT road_key FROM addr_road").fetchall()
        _roads = sorted((r["road_key"] for r in rows), key=len, reverse=True)
    return _roads


@dataclass
class Parsed:
    town: str | None
    road_text: str  # 使用者輸入的路名部分
    lane: str | None = None  # 數字巷為數字字串，命名巷為巷名（含「巷」）
    alley: int | None = None
    lin: bool = False
    door: int | None = None
    sub: int | None = None
    leftover: str = ""  # 解析不了的剩餘字（樓層等）


def parse_rest(town: str | None, road: str, rest: str) -> Parsed:
    m = REST_RE.match(rest)
    lane = m.group(1)
    if lane and not lane.isdigit():
        lane += "巷"
    return Parsed(
        town=town, road_text=road, lane=lane,
        alley=int(m.group(2)) if m.group(2) else None,
        lin=bool(m.group(3)), door=int(m.group(4)) if m.group(4) else None,
        sub=int(m.group(5)) if m.group(5) else None, leftover=rest[m.end():],
    )


def split_town(s: str) -> tuple[str | None, str]:
    for t in TOWNS:
        if s.startswith(t):
            return t, s[len(t):]
    return None, s


DOOR_COLS = """'door' AS kind, full_addr AS label, town, road, lane, alley_no, door,
       ST_X(ST_Transform(geom, 4326)) AS lng, ST_Y(ST_Transform(geom, 4326)) AS lat"""


def find_doors(conn, roads: list[str], p: Parsed, limit: int) -> list[dict]:
    """路名（可多條）＋巷／弄精確比對；號碼依接近程度排序（沒打巷弄時路上的門牌優先）。"""
    where = ["road_key = ANY(%(roads)s)"]
    args: dict = {"roads": roads, "limit": limit}
    if p.town:
        where.append("town = %(town)s")
        args["town"] = p.town
    if p.lane:
        if p.lane.isdigit():
            where.append("lane_no = %(lane)s")
            args["lane"] = int(p.lane)
        else:
            where.append("lane = %(lane)s")
            args["lane"] = p.lane
    if p.alley is not None:
        where.append("alley_no = %(alley)s")
        args["alley"] = p.alley
    # 沒指定巷弄時，路上的門牌（無巷）排前面
    # 沒指定巷（弄）時，路上（巷上）的門牌排前面
    order = []
    if not p.lane:
        order.append("(lane IS NULL) DESC")
    if p.alley is None:
        order.append("(alley_no IS NULL) DESC")
    if p.door is not None:
        args.update(door=p.door, sub=p.sub, lin=p.lin)
        order += [
            "abs(door_no - %(door)s)",
            "(door_sub IS NOT DISTINCT FROM %(sub)s) DESC",
            "(door_lin = %(lin)s) DESC",
        ]
    order += ["lane_no NULLS FIRST", "alley_no NULLS FIRST", "door_no NULLS LAST", "door_sub NULLS FIRST"]
    rows = conn.execute(
        f"SELECT {DOOR_COLS}, door_no, door_sub, door_lin FROM addr_door WHERE {' AND '.join(where)} "
        f"ORDER BY {', '.join(order)} LIMIT %(limit)s",
        args,
    ).fetchall()
    for r in rows:
        # 有打號碼但沒打巷弄時，巷弄內同號的門牌不算完全相符
        r["exact"] = p.door is None or (
            r["door_no"] == p.door and r["door_sub"] == p.sub and r["door_lin"] == p.lin
            and (p.lane is not None or r["lane"] is None) and (p.alley is not None or r["alley_no"] is None)
        )
        del r["door_no"], r["door_sub"], r["door_lin"]
    return rows


def road_results(conn, roads: list[str], town: str | None) -> list[dict]:
    """路段本身（代表點＋範圍），只打路名時給使用者直接定位到整條路。"""
    rows = conn.execute(
        """SELECT 'road' AS kind, town || road AS label, town, road, doors,
                  ST_X(ST_Transform(geom, 4326)) AS lng, ST_Y(ST_Transform(geom, 4326)) AS lat,
                  ARRAY[ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b)] AS bbox
           FROM addr_road, ST_Transform(bbox, 4326) AS b
           WHERE road_key = ANY(%(roads)s) AND (%(town)s::text IS NULL OR town = %(town)s)
           ORDER BY array_position(%(roads)s, road_key), doors DESC""",
        {"roads": roads, "town": town},
    ).fetchall()
    for r in rows:
        r["exact"] = True
    return rows


def fuzzy_roads(conn, text: str, town: str | None) -> list[str]:
    """路名錯字容錯：trigram 比對路名字典，取分數最高的（同分可多條）。"""
    rows = conn.execute(
        """SELECT road_key, max(similarity(road_key, %(q)s)) AS sim FROM (
               SELECT road_key FROM addr_road
               WHERE %(town)s::text IS NULL OR town = %(town)s
               ORDER BY road_key <-> %(q)s LIMIT 10) t
           GROUP BY road_key ORDER BY sim DESC LIMIT 5""",
        {"q": text, "town": town},
    ).fetchall()
    rows = [r for r in rows if r["sim"] >= ROAD_MIN_SIMILARITY]
    if not rows:
        return []
    best = rows[0]["sim"]
    return [r["road_key"] for r in rows if r["sim"] >= best - 0.05][:3]


def knn_doors(conn, s: str, limit: int) -> list[dict]:
    rows = conn.execute(
        f"SELECT {DOOR_COLS}, similarity(search_key, %(q)s) AS sim FROM addr_door "
        "ORDER BY search_key <-> %(q)s LIMIT %(limit)s",
        {"q": s, "limit": limit},
    ).fetchall()
    rows = [r for r in rows if r.pop("sim") >= KNN_MIN_SIMILARITY]  # 幾乎不像的不列（例如亂打英文）
    for r in rows:
        r["exact"] = False
    return rows


@router.get("/api/geocode")
def geocode(
    q: str = Query(..., min_length=1, max_length=100, description="門牌地址（可模糊，例如 忠孝東路4段100號）"),
    limit: int = Query(10, ge=1, le=50),
) -> dict:
    """臺北市門牌搜尋。results[].kind：door（門牌）或 road（路段，含 bbox [w,s,e,n]）；坐標 EPSG:4326。

    exact=false 表示不是完全相符（號碼找不到時列出最接近的號碼，或整串模糊比對的結果）。
    """
    t0 = time.perf_counter()
    s = normalize(q)
    town, body = split_town(s)
    method = "none"
    results: list[dict] = []
    with pool.connection() as conn:
        if body:
            road = next((r for r in road_keys(conn) if body.startswith(r)), None)
            # 路名打到一半（或剛好是較短的路名，例如「民生東路」也是「民生東路1段」的開頭）→ 補全
            completions = sorted(r for r in road_keys(conn) if r.startswith(body) and r != body)
            if completions and (road is None or road == body):
                p = Parsed(town=town, road_text=body)
                roads, method = ([body] if road else []) + completions[:ROAD_COMPLETIONS], "road-prefix"
            elif road:
                p = parse_rest(town, road, body[len(road):])
                roads, method = [road], "road"
            else:
                m = ROAD_PART_RE.match(body)
                road_text, rest = m.group(1), m.group(2)
                # 命名巷接在路名後面（例如 八德路2段光華一巷5號）時，巷不算路名
                nm = re.match(r"^(.*(?:路|街|道|段))([^\d巷弄號]{1,4}巷)$", road_text)
                if nm:
                    road_text, rest = nm.group(1), nm.group(2) + rest
                p = parse_rest(town, road_text, rest)
                roads, method = fuzzy_roads(conn, road_text, town), "fuzzy-road"
            if roads:
                has_detail = p.lane or p.alley is not None or p.door is not None
                n = limit if has_detail else min(limit, DOOR_ZOOM_ROWS)
                doors = find_doors(conn, roads, p, n)
                if not has_detail:
                    results = road_results(conn, roads, p.town)
                    doors = doors[: max(0, limit - len(results))]
                results += doors
            if not results:
                results, method = knn_doors(conn, s, limit), "knn"
        elif town:  # 只打行政區
            results = knn_doors(conn, s, limit)
            method = "knn"
    for r in results:
        r["lng"], r["lat"] = round(r["lng"], 7), round(r["lat"], 7)
        if "bbox" in r:
            r["bbox"] = [round(v, 7) for v in r["bbox"]]
    return {
        "query": q, "normalized": s, "method": method,
        "ms": round((time.perf_counter() - t0) * 1000, 1), "results": results[:limit],
    }
