# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg[binary]>=3.1"]
# ///
"""
臺北市門牌位置數值資料（CSV）匯入 PostgreSQL / PostGIS，供門牌模糊搜尋定位用。

用法：
    uv run addr2pg.py <臺北市門牌位置數值資料_YYYYMMDD.CSV> [--dsn "dbname=gis"]

產生兩張表（每次執行都 DROP 重建，整個匯入在同一個交易內）：
    addr_door  門牌（不含樓層；同一門牌各樓層合併成一筆）約 25.5 萬筆
    addr_road  路名字典（區＋街路段）約 920 筆，模糊比對路名用

正規化（search_key／road_key）：全形數字→半形、「N段」中文數字→阿拉伯數字、臺→台、去空白。
使用者輸入查詢時要套用同一套規則（見 normalize()）。

連線資訊同 xml2pg.py：libpq 環境變數或 %APPDATA%\\postgresql\\pgpass.conf，密碼不寫在程式裡。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from xml2pg import connect

TOWNS = {
    "63000010": "松山區", "63000020": "信義區", "63000030": "大安區", "63000040": "中山區",
    "63000050": "中正區", "63000060": "大同區", "63000070": "萬華區", "63000080": "文山區",
    "63000090": "南港區", "63000100": "內湖區", "63000110": "士林區", "63000120": "北投區",
}
FULLWIDTH = str.maketrans("０１２３４５６７８９　", "0123456789 ")
CN_DIGIT = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 門牌號：可有「臨」字頭、「之N」；號之後的樓層、備註一律捨棄（含 摟／慺 等錯字）
DOOR_RE = re.compile(r"^(臨)?(\d+)(?:之(\d+))?\s*號")


def halfwidth(s: str) -> str:
    return s.translate(FULLWIDTH).strip()


def normalize(s: str) -> str:
    """搜尋用正規化；API 處理使用者輸入時要用同一套規則。"""
    s = halfwidth(s).replace("臺", "台").replace(" ", "")
    return re.sub(r"([一二三四五六七八九])段", lambda m: f"{CN_DIGIT[m.group(1)]}段", s)


def leading_int(s: str) -> int | None:
    m = re.match(r"\d+", s)
    return int(m.group()) if m else None


def parse_door(raw: str) -> tuple[str, bool, int | None, int | None]:
    """回傳（門牌號文字、是否臨時門牌、號、之號）。解析不出來時保留原字串。"""
    s = halfwidth(raw)
    m = DOOR_RE.match(s)
    if not m:
        return s, False, None, None
    lin, main, sub = m.group(1), int(m.group(2)), m.group(3)
    text = f"{'臨' if lin else ''}{main}{'之' + sub if sub else ''}號"
    return text, bool(lin), main, int(sub) if sub else None


def read_doors(path: Path) -> list[dict]:
    doors: dict[tuple, dict] = {}
    coords: dict[tuple, Counter] = defaultdict(Counter)
    total = 0
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        if header[:9] != ["省市縣市代碼", "鄉鎮市區代碼", "村里", "鄰", "街路段", "地區", "巷", "弄", "號"]:
            sys.exit(f"欄位不符：{header}")
        for row in reader:
            total += 1
            town_code, village, neighbor, road, _, lane, alley, num, x, y = row[1:11]
            door, lin, main, sub = parse_door(num)
            lane, alley = halfwidth(lane), halfwidth(alley)
            key = (town_code, road, lane, alley, door)
            coords[key][(float(x), float(y))] += 1
            d = doors.get(key)
            if d is None:
                town = TOWNS.get(town_code)
                if town is None:
                    sys.exit(f"未知的鄉鎮市區代碼：{town_code}")
                road_disp = halfwidth(road)
                full = f"{town}{road_disp}{lane}{alley}{door}"
                doors[key] = {
                    "town_code": town_code, "town": town, "village": village,
                    "neighbor": halfwidth(neighbor) or None,
                    "road": road_disp, "road_key": normalize(road),
                    "lane": lane or None, "lane_no": leading_int(lane) if lane.endswith("巷") and lane[:1].isdigit() else None,
                    "alley_no": leading_int(alley), "door": door, "door_lin": lin,
                    "door_no": main, "door_sub": sub, "floors": 1,
                    "full_addr": full, "search_key": normalize(full),
                }
            else:
                d["floors"] += 1
    for key, d in doors.items():  # 同一門牌各樓坐標不一時（約 270 筆，差幾公尺）取最常出現的
        d["x"], d["y"] = coords[key].most_common(1)[0][0]
    print(f"讀取 {total:,} 筆 → 門牌 {len(doors):,} 個")
    return list(doors.values())


DOOR_COLS = [
    ("town_code", "text", "鄉鎮市區代碼"), ("town", "text", "行政區"),
    ("village", "text", "村里"), ("neighbor", "text", "鄰"),
    ("road", "text", "街路段（原文，數字轉半形）"), ("road_key", "text", "街路段（正規化，段為阿拉伯數字）"),
    ("lane", "text", "巷（原文，例如 30巷、銀光巷）"), ("lane_no", "integer", "巷號（數字巷才有）"),
    ("alley_no", "integer", "弄"), ("door", "text", "門牌號（例如 41之3號、臨5號）"),
    ("door_lin", "boolean", "臨時門牌（臨）"), ("door_no", "integer", "號"), ("door_sub", "integer", "之號"),
    ("floors", "integer", "原始資料中此門牌的筆數（各樓層）"),
    ("full_addr", "text", "完整門牌（顯示用）"), ("search_key", "text", "搜尋鍵（正規化完整門牌）"),
]


def import_all(conn, doors: list[dict], source: str) -> None:
    conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    conn.execute("DROP TABLE IF EXISTS public.addr_road, public.addr_door")
    cols_sql = ",\n  ".join(f"{c} {t}" for c, t, _ in DOOR_COLS)
    conn.execute(f"""CREATE TABLE public.addr_door (
  gid serial PRIMARY KEY,
  {cols_sql},
  geom geometry(Point, 3826) NOT NULL)""")
    names = [c for c, _, _ in DOOR_COLS]
    with conn.cursor().copy(f"COPY public.addr_door ({', '.join(names)}, geom) FROM STDIN") as cp:
        for d in doors:
            cp.write_row([d[c] for c in names] + [f"SRID=3826;POINT({d['x']!r} {d['y']!r})"])

    conn.execute("""CREATE TABLE public.addr_road AS
SELECT row_number() OVER (ORDER BY town_code, road_key)::int AS gid,
       town_code, town, road, road_key, count(*)::int AS doors,
       ST_ClosestPoint(ST_Collect(geom), ST_Centroid(ST_Collect(geom)))::geometry(Point, 3826) AS geom,
       ST_Envelope(ST_Collect(geom)) AS bbox
FROM public.addr_door GROUP BY town_code, town, road, road_key""")
    conn.execute("ALTER TABLE public.addr_road ADD PRIMARY KEY (gid)")

    for stmt in [
        "CREATE INDEX addr_door_struct_idx ON public.addr_door (road_key, lane, alley_no, door_no, door_sub)",
        "CREATE INDEX addr_door_search_trgm ON public.addr_door USING gist (search_key gist_trgm_ops)",
        "CREATE INDEX addr_door_geom_idx ON public.addr_door USING gist (geom)",
        "CREATE INDEX addr_road_key_trgm ON public.addr_road USING gist (road_key gist_trgm_ops)",
        "CREATE INDEX addr_road_key_idx ON public.addr_road (road_key)",
    ]:
        conn.execute(stmt)

    meta = {"source": source, "description": "臺北市門牌位置（不含樓層）"}
    conn.execute(f"COMMENT ON TABLE public.addr_door IS '{json.dumps(meta, ensure_ascii=False)}'")
    meta["description"] = "臺北市路名字典（區＋街路段），門牌搜尋模糊比對路名用"
    conn.execute(f"COMMENT ON TABLE public.addr_road IS '{json.dumps(meta, ensure_ascii=False)}'")
    for c, _, zh in DOOR_COLS + [("geom", "", "門牌位置（TWD97 TM2）")]:
        conn.execute(f"COMMENT ON COLUMN public.addr_door.{c} IS '{zh}'")
    for c, zh in [("doors", "門牌數"), ("geom", "代表點（最接近門牌重心的門牌）"), ("bbox", "門牌範圍")]:
        conn.execute(f"COMMENT ON COLUMN public.addr_road.{c} IS '{zh}'")
    conn.execute("ANALYZE public.addr_door")
    conn.execute("ANALYZE public.addr_road")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--dsn", default="")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    doors = read_doors(args.csv)
    with connect(args.dsn) as conn:
        import_all(conn, doors, args.csv.name)
        n_door = conn.execute("SELECT count(*) FROM public.addr_door").fetchone()[0]
        n_road = conn.execute("SELECT count(*) FROM public.addr_road").fetchone()[0]
    print(f"完成：addr_door {n_door:,} 筆、addr_road {n_road:,} 筆")


if __name__ == "__main__":
    main()
