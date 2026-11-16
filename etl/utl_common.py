"""
台北市公共管線 XML（內政部 utilityex / GML 格式）的共用讀取與資料清理。

xml2shp.py（輸出 Shapefile）與 xml2pg.py（匯入 PostGIS）共用本模組，
欄位定義、大寫轉換、同義值統一等規則只需在這裡維護。
"""
from __future__ import annotations

import datetime as dt
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

GML = "{http://www.opengis.net/gml}"

# ---------------------------------------------------------------- 欄位定義
# 中文欄位 → (英文欄位, 型別, 長度, 小數位)
#   型別：C 文字、N 數值（小數位 0 為整數）、D 日期
#   長度用於 Shapefile 的 DBF 欄寬；文字欄寬會依實際資料自動放大（上限 254）
FIELD_MAP: dict[str, tuple[str, str, int, int]] = {
    "類別碼":       ("CLASS_CODE", "C", 10, 0),
    "識別碼":       ("FEAT_ID",    "C", 30, 0),
    "起點編號":     ("START_NO",   "C", 20, 0),
    "終點編號":     ("END_NO",     "C", 20, 0),
    "管理單位":     ("MGMT_UNIT",  "C", 10, 0),
    "作業區分":     ("OP_TYPE",    "N", 4, 0),
    "設置日期":     ("SET_DATE",   "D", 8, 0),
    "管線編號":     ("PIPE_NO",    "C", 30, 0),
    "尺寸單位":     ("SIZE_UNIT",  "N", 4, 0),
    "管徑寬度":     ("DIA_WIDTH",  "N", 12, 3),
    "管徑高度":     ("DIA_HEIGHT", "N", 12, 3),
    "涵管條數":     ("PIPE_COUNT", "N", 6, 0),
    "管線材料":     ("MATERIAL",   "C", 30, 0),
    "起點埋設深度": ("START_DEP",  "N", 10, 3),
    "終點埋設深度": ("END_DEP",    "N", 10, 3),
    "管線長度":     ("PIPE_LEN",   "N", 14, 3),
    "管線型態":     ("PIPE_TYPE",  "N", 4, 0),
    "使用狀態":     ("USE_STAT",   "N", 4, 0),
    "資料狀態":     ("DATA_STAT",  "N", 4, 0),
    "備註":         ("REMARK",     "C", 254, 0),
}

# 需統一轉為大寫的文字欄位（中文欄位名）
UPPERCASE_FIELDS = {"管線材料"}

# 同義值統一（在轉大寫之後套用）：中文欄位 → {原值: 統一值}
VALUE_ALIASES: dict[str, dict[str, str]] = {
    "管線材料": {
        "PVC管": "PVC",
        "RCP管": "RCP",
        "D.I.P": "DIP",
        "PCVP": "PVCP",       # 疑似誤植
        "RPC": "RCP",         # 疑似誤植
        "不銹鋼管": "不鏽鋼管",
        "不鏽鋼壓力管": "不鏽鋼管",
        # 電信管線（8010101）的誤植
        "PCV": "PVC",
        "PV": "PVC",
        "PVC1": "PVC",
        "PVC2": "PVC",
        "PVCQ": "PVC",
        "PVT": "PVC",
        "OVC": "PVC",
        "{VC": "PVC",
        "鋼": "鋼管",
        "鋁": "鋁管",
        # 非材料的值 → 空值（未填）
        "0": "",
        "1": "",
        "1.6": "",
        "09201": "",
        "MM": "",
        "PIPE": "",
    },
}

# 圖徵類型 → 輸出名稱（Shapefile 檔名後綴 / PostGIS 資料表名）
FEATURE_SUFFIX = {"UTL_管線": "PIPE"}


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_coords(text: str, dim: int) -> list[list[float]]:
    v = [float(x) for x in text.split()]
    if len(v) % dim:
        raise ValueError(f"座標數量 {len(v)} 不是維度 {dim} 的倍數")
    pts = [v[i:i + dim] for i in range(0, len(v), dim)]
    if dim == 2:
        pts = [[x, y, 0.0] for x, y in pts]
    return pts


def parse_geometry(geom_el: ET.Element):
    """回傳 (幾何型別, 座標, srs代碼)。"""
    g = geom_el[0]
    kind = local(g.tag)
    dim = int(g.get("srsDimension", "3"))
    srs = (g.get("srsName") or "").split(":")[-1]
    if kind == "LineString":
        pos = g.find(f"{GML}posList")
        if pos is not None:
            return kind, parse_coords(pos.text, dim), srs
        pts = [parse_coords(p.text, dim)[0] for p in g.findall(f"{GML}pos")]
        return kind, pts, srs
    if kind == "Point":
        return kind, parse_coords(g.find(f"{GML}pos").text, dim), srs
    raise ValueError(f"尚未支援的幾何型別：{kind}")


def clean_value(name: str, value: str) -> str:
    """套用大寫轉換與同義值統一。"""
    if name in UPPERCASE_FIELDS:
        value = value.upper()
    return VALUE_ALIASES.get(name, {}).get(value, value)


def convert_value(raw: str, ftype: str, dec: int, empty_text=""):
    """將 XML 文字轉成對應型別；空值：文字欄回傳 empty_text，其他回傳 None。"""
    if raw == "":
        return empty_text if ftype == "C" else None
    if ftype == "N":
        x = float(raw)
        return int(round(x)) if dec == 0 else x
    if ftype == "D":
        return dt.date.fromisoformat(raw[:10])
    return raw


@dataclass
class LayerData:
    """同一種圖徵的全部資料。"""
    ftype: str
    geom_kind: str | None = None
    srs: str | None = None
    fields: list[str] = field(default_factory=list)       # 中文欄位（依出現順序）
    extra: dict[str, str] = field(default_factory=dict)   # 未定義欄位 → 自動英文名
    rows: list[tuple[list, dict]] = field(default_factory=list)

    @property
    def suffix(self) -> str:
        return FEATURE_SUFFIX.get(self.ftype, self.ftype.removeprefix("UTL_"))

    def field_def(self, name: str) -> tuple[str, str, int, int]:
        if name in FIELD_MAP:
            return FIELD_MAP[name]
        if name not in self.extra:
            self.extra[name] = f"FIELD_{len(self.extra) + 1:02d}"
            print(f"  [警告] 未定義欄位「{name}」→ 以 {self.extra[name]}（文字）輸出")
        return (self.extra[name], "C", 50, 0)

    def field_defs(self) -> list[tuple[str, str, str, int, int]]:
        """[(中文, 英文, 型別, 長度, 小數位), ...]"""
        return [(zh, *self.field_def(zh)) for zh in self.fields]

    def add(self, feat: ET.Element) -> None:
        attrs: dict[str, str] = {}
        coords = None
        for c in feat:
            name = local(c.tag)
            if name == "geometry":
                kind, coords, srs = parse_geometry(c)
                if self.geom_kind and kind != self.geom_kind:
                    raise ValueError(f"{self.ftype} 混合了 {self.geom_kind} 與 {kind}")
                self.geom_kind, self.srs = kind, self.srs or srs
                continue
            if name not in self.fields:
                self.fields.append(name)
                self.field_def(name)
            attrs[name] = clean_value(name, "".join(c.itertext()).strip())
        if coords is None:
            raise ValueError("圖徵缺少 geometry")
        self.rows.append((coords, attrs))


def read_layers(xml_path: Path) -> dict[str, LayerData]:
    """以串流方式讀取 XML，依圖徵類型分組回傳。"""
    layers: dict[str, LayerData] = {}
    depth = 0
    n = 0
    for ev, el in ET.iterparse(str(xml_path), events=("start", "end")):
        if ev == "start":
            depth += 1
            continue
        depth -= 1
        if depth == 2:  # UTL / featureMember / <圖徵>
            ftype = local(el.tag)
            layer = layers.setdefault(ftype, LayerData(ftype))
            try:
                layer.add(el)
            except ValueError as e:
                print(f"  [略過] 第 {n + 1} 筆 {ftype}：{e}")
            n += 1
            if n % 20000 == 0:
                print(f"  已讀取 {n:,} 筆…")
            el.clear()
        elif depth == 1:
            el.clear()
    print(f"讀取完成，共 {n:,} 筆圖徵。")
    return layers
