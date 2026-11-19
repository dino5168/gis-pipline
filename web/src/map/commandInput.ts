// 命令列的點位輸入解析（仿 AutoCAD）。內部一律用 TWD97 TM2 平面坐標（公尺）。
//   x,y        絕對坐標，依「設定 → 坐標系」：經緯度（經度,緯度）／TWD97／TWD67
//   @dx,dy     相對上一點（公尺，東、北為正）
//   @距離<角度  相對上一點的極坐標（公尺、度；0° 朝東、逆時針為正）；省略 @ 也視為相對（同 AutoCAD 動態輸入）
//   距離        直接距離：沿上一點 → 滑鼠方向
import { lngLatToTwd97, twd67ToTwd97, twd97ToTwd67, twd97ToLngLat } from './coordTransform';
import type { CoordDisplaySettings, CoordSystem } from '../types/coordSystem';

export type XY = [number, number];

export type PointInput = { ok: true; xy: XY } | { ok: false; error: string };

export interface PointContext {
  system: CoordSystem;
  /** 上一點（相對坐標、直接距離的基準） */
  last: XY | null;
  /** 滑鼠目前位置（直接距離的方向） */
  cursor: XY | null;
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const RE_XY = new RegExp(`^(${NUM}),(${NUM})$`);
const RE_POLAR = new RegExp(`^(${NUM})<(${NUM})$`);
const RE_DIST = new RegExp(`^(${NUM})$`);

const NO_LAST = '還沒有上一點，無法使用相對坐標或直接距離';

/** 解析點位輸入；不是點位語法時回傳 null（交給呼叫端判斷是不是選項關鍵字） */
export function parsePointInput(raw: string, ctx: PointContext): PointInput | null {
  const text = raw.replace(/\s+/g, '');
  const relative = text.startsWith('@');
  const body = relative ? text.slice(1) : text;

  const polar = RE_POLAR.exec(body);
  if (polar) {
    if (!ctx.last) return { ok: false, error: NO_LAST };
    const d = Number(polar[1]);
    const a = (Number(polar[2]) * Math.PI) / 180;
    return { ok: true, xy: [ctx.last[0] + d * Math.cos(a), ctx.last[1] + d * Math.sin(a)] };
  }

  const xy = RE_XY.exec(body);
  if (xy) {
    const a = Number(xy[1]);
    const b = Number(xy[2]);
    if (relative) {
      if (!ctx.last) return { ok: false, error: NO_LAST };
      return { ok: true, xy: [ctx.last[0] + a, ctx.last[1] + b] };
    }
    return absolutePoint(a, b, ctx.system);
  }

  const dist = RE_DIST.exec(body);
  if (dist && !relative) {
    if (!ctx.last) return { ok: false, error: NO_LAST };
    const c = ctx.cursor;
    const dx = c ? c[0] - ctx.last[0] : 0;
    const dy = c ? c[1] - ctx.last[1] : 0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { ok: false, error: '直接距離需要先把滑鼠移到要畫的方向' };
    const d = Number(dist[1]);
    return { ok: true, xy: [ctx.last[0] + (dx / len) * d, ctx.last[1] + (dy / len) * d] };
  }

  if (relative) return { ok: false, error: '相對坐標格式為 @dx,dy 或 @距離<角度' };
  return null;
}

function absolutePoint(a: number, b: number, system: CoordSystem): PointInput {
  if (system === 'wgs84') {
    if (Math.abs(a) > 180 || Math.abs(b) > 90) {
      return { ok: false, error: '經緯度超出範圍（目前坐標系是經緯度，格式為 經度,緯度）' };
    }
    return { ok: true, xy: lngLatToTwd97(a, b) };
  }
  // TM2 坐標：粗略檢查是否在台灣附近，避免把經緯度誤當公尺
  if (a < 0 || a > 1_000_000 || b < 1_000_000 || b > 4_000_000) {
    return { ok: false, error: `坐標超出 ${system === 'twd97' ? 'TWD97' : 'TWD67'} TM2 範圍（格式為 X,Y，公尺）` };
  }
  return { ok: true, xy: system === 'twd67' ? twd67ToTwd97(a, b) : [a, b] };
}

/** TWD97 坐標依目前坐標系設定格式化（回顯用） */
export function formatPoint(xy: XY, s: CoordDisplaySettings): string {
  if (s.system === 'wgs84') {
    const [lng, lat] = twd97ToLngLat(xy[0], xy[1]);
    return `${lng.toFixed(s.lngLatDecimals)},${lat.toFixed(s.lngLatDecimals)}`;
  }
  const [x, y] = s.system === 'twd67' ? twd97ToTwd67(xy[0], xy[1]) : xy;
  return `${x.toFixed(s.xDecimals)},${y.toFixed(s.yDecimals)}`;
}
