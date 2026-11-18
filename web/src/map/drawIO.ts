// 2D 繪圖：GeoJSON 匯出／匯入（EPSG:4326 經緯度）。
// 匯出：每個圖形一個 Feature，properties.mode 為圖形種類（point／linestring／polygon／rectangle／circle／text；
// 有洞的多邊形匯出成 polygon），文字標註為 Point＋text，圓另帶 radiusM（TWD97 計算的半徑，公尺）。
// 匯入：接受 FeatureCollection／Feature／Geometry（含 Multi* 與 GeometryCollection，拆成單一圖形），
// 依幾何與 properties.mode 決定圖形種類；Terra Draw 驗證不過時依序改用較寬鬆的種類（矩形／圓 → 多邊形 → 有洞多邊形）。
import type { Feature, FeatureCollection, Position } from 'geojson';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import { HOLED_MODE, cleanRing } from './drawCut';
import { DRAW_TEXT_MAX_LENGTH } from '../types/draw';

/** 匯出的檔案類型 */
export const DRAW_GEOJSON_MIME = 'application/geo+json';

/** 匯出一個圖形 */
export function toExportFeature(f: GeoJSONStoreFeatures, radiusM?: number): Feature {
  const mode = f.properties.mode === HOLED_MODE ? 'polygon' : String(f.properties.mode);
  const properties: Record<string, unknown> = { mode };
  if (typeof f.properties.text === 'string') properties.text = f.properties.text;
  if (radiusM !== undefined) properties.radiusM = Math.round(radiusM * 100) / 100;
  return { type: 'Feature', id: f.id ?? undefined, geometry: structuredClone(f.geometry), properties };
}

export function toFeatureCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

/** 一個要匯入的圖形：依序嘗試 modes 裡的圖形種類，第一個驗證通過的就用它 */
export interface ImportCandidate {
  feature: GeoJSONStoreFeatures;
  modes: string[];
}

export interface ParsedImport {
  candidates: ImportCandidate[];
  /** 無法解讀的圖形數（不支援的幾何、坐標不是經緯度等） */
  skipped: number;
}

type Props = Record<string, unknown>;
interface RawGeometry {
  geometry: unknown;
  properties: Props;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 攤平成「幾何＋屬性」的清單 */
function collect(data: unknown, out: RawGeometry[], props: Props = {}): number {
  if (!isObject(data)) return 1;
  if (data.type === 'FeatureCollection') {
    if (!Array.isArray(data.features)) return 1;
    return data.features.reduce<number>((n, f) => n + collect(f, out), 0);
  }
  if (data.type === 'Feature') {
    if (data.geometry === null) return 1;
    return collect(data.geometry, out, isObject(data.properties) ? data.properties : {});
  }
  if (data.type === 'GeometryCollection') {
    if (!Array.isArray(data.geometries)) return 1;
    return data.geometries.reduce<number>((n, g) => n + collect(g, out, props), 0);
  }
  out.push({ geometry: data, properties: props });
  return 0;
}

/** 經緯度坐標（去掉 Z）；不合法回傳 null */
function toPosition(p: unknown, precision: number): Position | null {
  if (!Array.isArray(p) || p.length < 2) return null;
  const [x, y] = p as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < -180 || x > 180 || y < -90 || y > 90) return null;
  return [Number(x.toFixed(precision)), Number(y.toFixed(precision))];
}

function toPositions(list: unknown, precision: number): Position[] | null {
  if (!Array.isArray(list)) return null;
  const out: Position[] = [];
  for (const p of list) {
    const q = toPosition(p, precision);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

function lineCandidate(coords: unknown, precision: number): ImportCandidate | null {
  const pts = toPositions(coords, precision);
  if (!pts) return null;
  // 去掉連續重複點
  const line = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (line.length < 2) return null;
  return {
    feature: { type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { mode: 'linestring' } },
    modes: ['linestring'],
  };
}

function polygonCandidate(coords: unknown, props: Props, precision: number): ImportCandidate | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const rings: Position[][] = [];
  for (const [i, r] of coords.entries()) {
    const pts = toPositions(r, precision);
    if (!pts) return null;
    const ring = cleanRing(pts, precision);
    if (ring) rings.push(ring);
    else if (i === 0) return null; // 外環退化
  }
  const modes =
    rings.length > 1
      ? [HOLED_MODE]
      : props.mode === 'rectangle' || props.mode === 'circle'
        ? [props.mode, 'polygon', HOLED_MODE]
        : ['polygon', HOLED_MODE];
  return {
    feature: { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: { mode: modes[0] } },
    modes,
  };
}

function pointCandidate(coords: unknown, props: Props, precision: number): ImportCandidate | null {
  const p = toPosition(coords, precision);
  if (!p) return null;
  const text = typeof props.text === 'string' ? props.text.trim().slice(0, DRAW_TEXT_MAX_LENGTH) : '';
  const mode = text ? 'text' : 'point';
  const properties: GeoJSONStoreFeatures['properties'] = text ? { mode, text } : { mode };
  return { feature: { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties }, modes: [mode] };
}

/** 一個幾何（Multi* 拆開）轉成匯入候選；回傳無法解讀的數目 */
function toCandidates({ geometry: g, properties }: RawGeometry, precision: number, out: ImportCandidate[]): number {
  if (!isObject(g) || !Array.isArray(g.coordinates)) return 1;
  const parts: (ImportCandidate | null)[] = [];
  const c = g.coordinates as unknown[];
  switch (g.type) {
    case 'Point':
      parts.push(pointCandidate(c, properties, precision));
      break;
    case 'MultiPoint':
      parts.push(...c.map((p) => pointCandidate(p, properties, precision)));
      break;
    case 'LineString':
      parts.push(lineCandidate(c, precision));
      break;
    case 'MultiLineString':
      parts.push(...c.map((l) => lineCandidate(l, precision)));
      break;
    case 'Polygon':
      parts.push(polygonCandidate(c, properties, precision));
      break;
    case 'MultiPolygon':
      parts.push(...c.map((p) => polygonCandidate(p, properties, precision)));
      break;
    default:
      return 1;
  }
  let bad = 0;
  for (const p of parts) {
    if (p) out.push(p);
    else bad++;
  }
  return bad;
}

/** 解讀匯入的 GeoJSON（已 JSON.parse） */
export function parseImport(data: unknown, precision: number): ParsedImport {
  const raw: RawGeometry[] = [];
  let skipped = collect(data, raw);
  const candidates: ImportCandidate[] = [];
  for (const r of raw) skipped += toCandidates(r, precision, candidates);
  return { candidates, skipped };
}
