"""3D 管線格網：預先產生、API 讀取。

把每種管線依「起點所在的 z16 格子」（與 Web Mercator 圖磚編號相同）分組，每格一包 JSON
（格式同 /api/pipes3d 的 pipes 陣列），gzip 壓縮後存進 tiles/pipes3d/<資料表>.sqlite。
API 只讀這個檔，不查 PostgreSQL；格子網址固定，瀏覽器／Nginx 可以快取。
資料更新（重新匯入）後要重新產生：在 8-Project\\api 執行
    uv run python -m app.pipes3d_tiles [資料表 ...]
（tiles\\build-mbtiles.ps1 會一併執行）。
"""
from __future__ import annotations

import argparse
import gzip
import os
import sqlite3
import time
from datetime import datetime
from pathlib import Path

# 格子層級（z16：台北一格約 600m × 550m，電信最密的一格約 2,700 筆）
TILE_ZOOM = 16
# 預產檔放的資料夾（預設 8-Project/tiles/pipes3d，可用環境變數 PIPES3D_DIR 改）
STORE_DIR = Path(os.environ.get("PIPES3D_DIR") or Path(__file__).resolve().parents[2] / "tiles" / "pipes3d")

# 管徑換算成公尺：size_unit 0=mm、1=英吋、2=cm、3=m（依資料分布推定：0 中位數 200、1 為 1~12、2 為 10~30、3 為 0.1~0.25）
UNIT_M = "CASE size_unit WHEN 1 THEN 0.0254 WHEN 2 THEN 0.01 WHEN 3 THEN 1 ELSE 0.001 END"
DIA_M = f"dia_width * {UNIT_M}"
# 管徑高度（公尺）：0 或缺值表示圓管（只有寬度）→ null
HEIGHT_M = f"CASE WHEN dia_height > 0 THEN dia_height * {UNIT_M} END"
# 一條管線的 3D 精簡欄位（/api/pipes3d 與格網共用，前端型別 types/pipe3d.ts 的 Pipe3D）
PIPE_COLUMNS = f"""p.gid, p.material AS mat, round(({DIA_M})::numeric, 4)::float8 AS dia,
                   round(({HEIGHT_M})::numeric, 4)::float8 AS h, p.pipe_count AS n,
                   p.start_dep AS sd, p.end_dep AS ed, p.geom"""
PIPE_JSON = """json_build_object(
                'gid', gid, 'mat', mat, 'dia', dia, 'h', h, 'n', n, 'sd', sd, 'ed', ed,
                'coords', ST_AsGeoJSON(ST_Transform(geom, 4326), 8)::json -> 'coordinates')"""

EMPTY_TILE = gzip.compress(b'{"pipes":[]}', mtime=0)
_MERC = 20037508.342789244  # Web Mercator 半周長（公尺）


def store_path(layer: str) -> Path:
    return STORE_DIR / f"{layer}.sqlite"


def read_tile(layer: str, x: int, y: int) -> tuple[bytes, str] | None:
    """回傳（gzip 後的 JSON, 版本字串）；預產檔不存在回傳 None。沒有管線的格子回傳空陣列。"""
    path = store_path(layer)
    if not path.exists():
        return None
    # 每次請求開一次唯讀連線（約 0.1ms），重新產生時檔案不會一直被鎖住
    con = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        version = con.execute("SELECT value FROM metadata WHERE name = 'version'").fetchone()[0]
        row = con.execute("SELECT data FROM tiles WHERE x = ? AND y = ?", (x, y)).fetchone()
    finally:
        con.close()
    return (row[0] if row else EMPTY_TILE), version


def build(layers: list[str], conninfo: str) -> None:
    import psycopg
    from psycopg import sql

    STORE_DIR.mkdir(parents=True, exist_ok=True)
    size = 2 * _MERC / 2**TILE_ZOOM
    query = sql.SQL(f"""
        WITH r AS (
            SELECT {PIPE_COLUMNS}, ST_Transform(ST_StartPoint(p.geom), 3857) AS sp
            FROM {{tbl}} p
        ), k AS (
            SELECT r.*, floor((ST_X(sp) + {_MERC}) / {size})::int AS x,
                        floor(({_MERC} - ST_Y(sp)) / {size})::int AS y
            FROM r
        )
        SELECT x, y, count(*) AS n,
               json_build_object('pipes', json_agg({PIPE_JSON} ORDER BY gid))::text AS body
        FROM k GROUP BY x, y
    """)
    version = datetime.now().strftime("%Y%m%d%H%M%S")
    with psycopg.connect(conninfo) as pg:
        for layer in layers:
            t0 = time.perf_counter()
            final = store_path(layer)
            tmp = final.with_suffix(".sqlite.tmp")
            tmp.unlink(missing_ok=True)
            out = sqlite3.connect(tmp)
            out.executescript("""
                CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE tiles (x INTEGER, y INTEGER, n INTEGER, data BLOB, PRIMARY KEY (x, y));
            """)
            tiles = pipes = raw = 0
            for x, y, n, body in pg.execute(query.format(tbl=sql.Identifier(layer))):
                b = body.encode()
                out.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (x, y, n, gzip.compress(b, 6, mtime=0)))
                tiles += 1; pipes += n; raw += len(b)
            out.executemany("INSERT INTO metadata VALUES (?, ?)",
                            [("layer", layer), ("zoom", str(TILE_ZOOM)), ("version", version)])
            out.commit()
            out.close()
            for i in range(20):  # API 讀取中檔案可能短暫被占用
                try:
                    os.replace(tmp, final)
                    break
                except PermissionError:
                    if i == 19:
                        raise
                    time.sleep(0.1)
            print(f"{layer}: {tiles} 格、{pipes} 筆、JSON {raw / 1e6:.1f}MB → 檔案 "
                  f"{final.stat().st_size / 1e6:.1f}MB，{time.perf_counter() - t0:.1f} 秒")


if __name__ == "__main__":
    from .db import _conninfo
    from .main import PIPE_LAYERS

    ap = argparse.ArgumentParser(description="預先產生 3D 管線格網（z16）")
    ap.add_argument("layers", nargs="*", help=f"資料表（預設全部：{', '.join(PIPE_LAYERS)}）")
    args = ap.parse_args()
    unknown = [l for l in args.layers if l not in PIPE_LAYERS]
    if unknown:
        raise SystemExit(f"不認得的資料表：{', '.join(unknown)}")
    build(args.layers or list(PIPE_LAYERS), _conninfo())
