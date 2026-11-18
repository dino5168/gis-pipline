// 2D 繪圖：挖洞（同 Leaflet-Geoman 的 Cut）。
// 畫一個多邊形當刀，與它重疊的面（多邊形／矩形／圓／已挖洞的面）都減去它：在內部＝挖洞、跨邊界＝切掉一塊、
// 切成多塊＝拆成多個圖形、完全蓋住＝刪除。線、點、文字不受影響。差集用 @turf/difference（經緯度平面計算）。
// Terra Draw 不支援有洞的多邊形（驗證擋掉，拖曳／編輯頂點只處理外環），所以有洞的結果另外登錄成
// 自訂模式 HOLED_MODE：允許多個環；不能編輯頂點，拖曳由 DrawTool 自己處理（所有環一起平移）。
import difference from '@turf/difference';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { TerraDrawPolygonMode, type GeoJSONStoreFeatures } from 'terra-draw';

type FeatureId = string | number;
type StoreValidation = ReturnType<TerraDrawPolygonMode['validateFeature']>;

/** 挖洞時畫刀的 Terra Draw 模式名稱（畫完即刪除，不留在圖上） */
export const CUT_MODE = 'cut';
/** 有洞的多邊形 */
export const HOLED_MODE = 'holed';
/** 可以被挖洞的圖形 */
export const CUTTABLE_MODES: ReadonlySet<string> = new Set(['polygon', 'rectangle', 'circle', HOLED_MODE]);

/** 面積相對變化小於此值視為沒有重疊（不改動原圖形） */
const UNCHANGED_EPS = 1e-9;

function validCoordinate(p: unknown, precision: number): boolean {
  if (!Array.isArray(p) || p.length !== 2) return false;
  const [x, y] = p as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < -180 || x > 180 || y < -90 || y > 90) return false;
  return Number(x.toFixed(precision)) === x && Number(y.toFixed(precision)) === y;
}

/** 有洞多邊形的驗證：每個環至少 4 點、首尾相同、坐標合法且小數位數不超過 precision */
function validateHoledPolygon(f: GeoJSONStoreFeatures, precision: number): StoreValidation {
  if (f.geometry.type !== 'Polygon') return { valid: false, reason: 'Feature is not a Polygon' };
  const rings = f.geometry.coordinates;
  if (rings.length < 1) return { valid: false, reason: 'Polygon has no rings' };
  for (const ring of rings) {
    if (ring.length < 4) return { valid: false, reason: 'Ring has less than 4 coordinates' };
    if (!ring.every((p) => validCoordinate(p, precision))) return { valid: false, reason: 'Ring has invalid coordinates' };
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) return { valid: false, reason: 'Ring is not closed' };
  }
  return { valid: true };
}

/** 有洞的多邊形：沿用多邊形模式的樣式與繪製，只放寬驗證（允許洞）；不會被切換成目前模式 */
export class TerraDrawHoledPolygonMode extends TerraDrawPolygonMode {
  private readonly precision: number;

  constructor(options: ConstructorParameters<typeof TerraDrawPolygonMode>[0] & { precision: number }) {
    const { precision, ...rest } = options;
    super({ ...rest, modeName: HOLED_MODE });
    this.precision = precision;
  }

  override validateFeature(feature: unknown): StoreValidation {
    return this.validateModeFeature(feature, (f) => validateHoledPolygon(f, this.precision));
  }
}

/** 經緯度平面上的環面積（不帶正負號，只用來判斷有沒有變化） */
function ringArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s) / 2;
}

function polygonsArea(polys: Position[][][]): number {
  return polys.reduce((s, rings) => s + ringArea(rings[0]) - rings.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
}

/** 四捨五入到 precision、去掉連續重複點、首尾閉合；不足 3 個不同點回傳 null */
function cleanRing(ring: Position[], precision: number): Position[] | null {
  const out: Position[] = [];
  for (const p of ring) {
    const q = [Number(p[0].toFixed(precision)), Number(p[1].toFixed(precision))];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const a = out[0];
  const b = out[out.length - 1];
  if (out.length > 1 && a[0] === b[0] && a[1] === b[1]) out.pop();
  if (out.length < 3) return null;
  out.push([...out[0]]);
  return out;
}

function cleanPolygon(rings: Position[][], precision: number): Position[][] | null {
  const outer = cleanRing(rings[0], precision);
  if (!outer) return null;
  const holes = rings.slice(1).map((r) => cleanRing(r, precision)).filter((r): r is Position[] => r !== null);
  return [outer, ...holes];
}

export interface CutResult {
  /** 要移除的原圖形 */
  removeIds: FeatureId[];
  /** 切完的新圖形（有洞＝HOLED_MODE，否則 polygon；矩形、圓切過就變成一般多邊形） */
  add: GeoJSONStoreFeatures[];
}

/** 用 cutter 切 targets 裡的每個面；沒有重疊的不動 */
export function cutFeatures(targets: GeoJSONStoreFeatures[], cutter: Polygon, precision: number): CutResult {
  const removeIds: FeatureId[] = [];
  const add: GeoJSONStoreFeatures[] = [];
  const knife: Feature<Polygon> = { type: 'Feature', geometry: cutter, properties: {} };
  for (const t of targets) {
    if (t.geometry.type !== 'Polygon') continue;
    const original = t.geometry.coordinates;
    const result: Feature<Polygon | MultiPolygon> | null = difference({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: original }, properties: {} }, knife],
    });
    const polys = !result
      ? []
      : result.geometry.type === 'Polygon'
        ? [result.geometry.coordinates]
        : result.geometry.coordinates;
    const before = polygonsArea([original]);
    if (result && Math.abs(polygonsArea(polys) - before) <= before * UNCHANGED_EPS) continue;
    removeIds.push(t.id as FeatureId);
    for (const rings of polys) {
      const clean = cleanPolygon(rings, precision);
      if (!clean) continue;
      add.push({
        type: 'Feature',
        id: crypto.randomUUID(),
        geometry: { type: 'Polygon', coordinates: clean },
        properties: { mode: clean.length > 1 ? HOLED_MODE : 'polygon' },
      });
    }
  }
  return { removeIds, add };
}
