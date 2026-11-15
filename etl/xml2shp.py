# /// script
# requires-python = ">=3.10"
# dependencies = ["pyshp>=2.3"]
# ///
"""
台北市公共管線 XML（內政部 utilityex / GML 格式）轉 Shapefile。

用法：
    uv run xml2shp.py <輸入.xml> [輸出資料夾]

說明：
- 讀取與資料清理規則在 utl_common.py（與 xml2pg.py 共用）。
- 每一種圖徵類型（例如 UTL_管線）輸出一組 shapefile。
- 幾何保留 Z 值：LineString → PolyLineZ，Point → PointZ。
- 屬性以 UTF-8 編碼，並輸出 .cpg 與 .prj（依 srsName，預設 EPSG:3826 TWD97 TM2）。
- 欄位名稱使用英文縮寫（DBF 欄位名稱限 10 bytes），另輸出「英文 ↔ 中文」對照表 CSV。
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import shapefile  # pyshp

from utl_common import LayerData, convert_value, read_layers

PRJ_WKT = {
    "3826": (
        'PROJCS["TWD_1997_TM_Taiwan",GEOGCS["GCS_TWD_1997",DATUM["D_TWD_1997",'
        'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],'
        'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
        'PARAMETER["False_Easting",250000.0],PARAMETER["False_Northing",0.0],'
        'PARAMETER["Central_Meridian",121.0],PARAMETER["Scale_Factor",0.9999],'
        'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    ),
    "3825": (
        'PROJCS["TWD_1997_TM_Penghu",GEOGCS["GCS_TWD_1997",DATUM["D_TWD_1997",'
        'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],'
        'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
        'PARAMETER["False_Easting",250000.0],PARAMETER["False_Northing",0.0],'
        'PARAMETER["Central_Meridian",119.0],PARAMETER["Scale_Factor",0.9999],'
        'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    ),
}


def write_shapefile(layer: LayerData, out_base: Path, encoding: str = "utf-8") -> list[tuple]:
    defs = layer.field_defs()
    # 文字欄寬依實際資料（bytes）放大
    widths = {}
    for zh, en, t, size, dec in defs:
        if t == "C":
            mx = max((len(a.get(zh, "").encode(encoding)) for _, a in layer.rows), default=1)
            widths[zh] = min(254, max(size, mx))
    shp_type = shapefile.POLYLINEZ if layer.geom_kind == "LineString" else shapefile.POINTZ
    w = shapefile.Writer(str(out_base), shapeType=shp_type, encoding=encoding)
    try:
        for zh, en, t, size, dec in defs:
            w.field(en, t, size=widths.get(zh, size), decimal=dec)
        for coords, attrs in layer.rows:
            if shp_type == shapefile.POLYLINEZ:
                w.linez([coords])
            else:
                w.pointz(*coords[0])
            rec = []
            for zh, en, t, size, dec in defs:
                try:
                    # pyshp 會把文字欄的 None 寫成 "None"，所以空文字用 ""
                    rec.append(convert_value(attrs.get(zh, ""), t, dec, empty_text=""))
                except ValueError:
                    print(f"  [警告] 欄位 {zh} 值「{attrs.get(zh)}」無法轉換，設為空值")
                    rec.append("" if t == "C" else None)
            w.record(*rec)
    finally:
        w.close()
    out_base.with_suffix(".cpg").write_text("UTF-8", encoding="ascii")
    wkt = PRJ_WKT.get(layer.srs or "")
    if wkt:
        out_base.with_suffix(".prj").write_text(wkt, encoding="ascii")
    else:
        print(f"  [警告] 未知座標系統 EPSG:{layer.srs}，未輸出 .prj")
    return [(en, zh, t, widths.get(zh, size), dec) for zh, en, t, size, dec in defs]


def convert(xml_path: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    layers = read_layers(xml_path)
    mapping_rows = []
    for ftype, layer in layers.items():
        base = out_dir / f"{xml_path.stem}_{layer.suffix}"
        print(f"輸出 {ftype}（{len(layer.rows):,} 筆）→ {base}.shp")
        for en, zh, t, size, dec in write_shapefile(layer, base):
            mapping_rows.append((base.name, en, zh, t, size, dec))

    map_csv = out_dir / f"{xml_path.stem}_欄位對照表.csv"
    with map_csv.open("w", encoding="utf-8-sig", newline="") as f:
        cw = csv.writer(f)
        cw.writerow(["圖層", "英文欄位", "中文欄位", "型別", "長度", "小數位"])
        cw.writerows(mapping_rows)
    print(f"欄位對照表 → {map_csv}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    xml_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else xml_path.parent.parent / "Output"
    convert(xml_path, out_dir)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
