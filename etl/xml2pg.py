# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg[binary]>=3.1"]
# ///
"""
台北市公共管線 XML（內政部 utilityex / GML 格式）匯入 PostgreSQL / PostGIS。

用法：
    uv run xml2pg.py <輸入.xml> [選項]

選項：
    --dsn "host=localhost dbname=gis user=postgres"   連線字串（可省略，見下方）
    --schema utl        匯入的 schema（預設 public，不存在會自動建立）
    --prefix utl_       資料表名稱前綴（預設 utl_，例如 utl_pipe）
    --append            附加模式：保留資料表，只先刪除同一來源檔的舊資料再匯入
                        （預設為重建資料表）

連線資訊（密碼不要寫在程式裡）：
    使用 libpq 標準環境變數 PGHOST、PGPORT、PGDATABASE、PGUSER、PGPASSWORD，
    或密碼檔 %APPDATA%\\postgresql\\pgpass.conf；未指定時預設 localhost / postgres / postgres。

說明：
- 讀取與資料清理規則在 utl_common.py（與 xml2shp.py 共用）。
- 幾何保留 Z 值：geometry(LineStringZ, 3826) / geometry(PointZ, 3826)，並建立 GIST 索引。
- 欄位使用小寫英文名稱，中文名稱寫在欄位註解（COMMENT ON COLUMN）。
- 以 COPY 批次寫入，整個匯入在同一個交易內，失敗時不會留下半套資料。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from utl_common import LayerData, convert_value, read_layers

GEOM_TYPE = {"LineString": "LineStringZ", "Point": "PointZ"}


def pg_type(t: str, dec: int) -> str:
    if t == "C":
        return "text"
    if t == "D":
        return "date"
    return "integer" if dec == 0 else "double precision"


def to_ewkt(kind: str, coords: list[list[float]], srid: int) -> str:
    pts = ", ".join(f"{x!r} {y!r} {z!r}" for x, y, z in coords)
    if kind == "LineString":
        return f"SRID={srid};LINESTRING Z ({pts})"
    return f"SRID={srid};POINT Z ({pts})"


def connect(dsn: str) -> psycopg.Connection:
    given = conninfo_to_dict(dsn)
    defaults = {"host": ("PGHOST", "localhost"),
                "user": ("PGUSER", "postgres"),
                "dbname": ("PGDATABASE", "postgres")}
    kwargs = {k: v for k, (env, v) in defaults.items() if k not in given and env not in os.environ}
    return psycopg.connect(dsn, **kwargs)


def ensure_postgis(conn: psycopg.Connection) -> None:
    try:
        conn.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        conn.commit()
    except psycopg.Error as e:
        conn.rollback()
        print(f"  [警告] 無法建立 postgis 擴充（{e.diag.message_primary}）")
    row = conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'postgis'").fetchone()
    if not row:
        sys.exit("資料庫尚未啟用 PostGIS，請以超級使用者執行：CREATE EXTENSION postgis;")
    print(f"PostGIS {row[0]}")


def import_layer(conn: psycopg.Connection, layer: LayerData, schema: str, table: str,
                 source: str, append: bool) -> None:
    if layer.geom_kind not in GEOM_TYPE:
        print(f"  [略過] {layer.ftype}：不支援的幾何型別 {layer.geom_kind}")
        return
    srid = int(layer.srs or 3826)
    defs = layer.field_defs()
    cols = [(zh, en.lower(), t, dec) for zh, en, t, size, dec in defs]
    tbl = sql.Identifier(schema, table)

    with conn.transaction():
        if schema != "public":
            conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
        if not append:
            conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(tbl))
        col_sql = [sql.SQL("gid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY")]
        col_sql += [sql.SQL("{} {}").format(sql.Identifier(en), sql.SQL(pg_type(t, dec)))
                    for _, en, t, dec in cols]
        col_sql += [sql.SQL("source_file text"),
                    sql.SQL("geom geometry({}, {})").format(
                        sql.SQL(GEOM_TYPE[layer.geom_kind]), sql.Literal(srid))]
        conn.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {} ({})").format(
            tbl, sql.SQL(", ").join(col_sql)))
        if append:
            cur = conn.execute(sql.SQL("DELETE FROM {} WHERE source_file = %s").format(tbl), [source])
            if cur.rowcount:
                print(f"  刪除同來源舊資料 {cur.rowcount:,} 筆")

        copy_cols = [en for _, en, _, _ in cols] + ["source_file", "geom"]
        copy_stmt = sql.SQL("COPY {} ({}) FROM STDIN").format(
            tbl, sql.SQL(", ").join(map(sql.Identifier, copy_cols)))
        n = 0
        with conn.cursor() as cur, cur.copy(copy_stmt) as cp:
            for coords, attrs in layer.rows:
                rec = []
                for zh, en, t, dec in cols:
                    try:
                        rec.append(convert_value(attrs.get(zh, ""), t, dec, empty_text=None))
                    except ValueError:
                        print(f"  [警告] 欄位 {zh} 值「{attrs.get(zh)}」無法轉換，設為空值")
                        rec.append(None)
                rec += [source, to_ewkt(layer.geom_kind, coords, srid)]
                cp.write_row(rec)
                n += 1

        conn.execute(sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} USING GIST (geom)").format(
            sql.Identifier(f"{table}_geom_idx"), tbl))
        # Martin 會把資料表註解當成 TileJSON 讀取，所以寫成 JSON
        conn.execute(sql.SQL("COMMENT ON TABLE {} IS {}").format(
            tbl, sql.Literal(json.dumps({"description": f"台北市公共管線 {layer.ftype}"},
                                        ensure_ascii=False))))
        for zh, en, _, _ in cols:
            conn.execute(sql.SQL("COMMENT ON COLUMN {}.{} IS {}").format(
                tbl, sql.Identifier(en), sql.Literal(zh)))
        conn.execute(sql.SQL("COMMENT ON COLUMN {}.source_file IS {}").format(
            tbl, sql.Literal("來源 XML 檔名")))
    conn.execute(sql.SQL("ANALYZE {}").format(tbl))
    total = conn.execute(sql.SQL("SELECT count(*) FROM {}").format(tbl)).fetchone()[0]
    print(f"  寫入 {n:,} 筆，資料表目前共 {total:,} 筆")


def main() -> None:
    ap = argparse.ArgumentParser(description="台北市公共管線 XML 匯入 PostGIS")
    ap.add_argument("xml", type=Path)
    ap.add_argument("--dsn", default="")
    ap.add_argument("--schema", default="public")
    ap.add_argument("--prefix", default="utl_")
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args()

    layers = read_layers(args.xml)
    with connect(args.dsn) as conn:
        info = conn.info
        print(f"連線 {info.user}@{info.host}:{info.port}/{info.dbname}")
        ensure_postgis(conn)
        for ftype, layer in layers.items():
            table = f"{args.prefix}{layer.suffix}".lower()
            print(f"匯入 {ftype}（{len(layer.rows):,} 筆）→ {args.schema}.{table}")
            import_layer(conn, layer, args.schema, table, args.xml.name, args.append)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
