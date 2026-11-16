// 比例尺距離計算：由地面解析度（公尺／像素）和最大寬度，取一個整數總長。
import type { ScaleBarUnit } from '../types/scaleBar';

const FEET_PER_METER = 3.28084;
const FEET_PER_MILE = 5280;

export interface ScaleBarLayout {
  /** 比例尺總寬（px） */
  width: number;
  /** 總長（顯示單位） */
  total: number;
  unitLabel: string;
}

/** 總長取 {1, 2, 4, 8} × 10ⁿ：四分之一、二分之一處的刻度也會是好讀的數字 */
function niceTotal(max: number): number {
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  const m = f >= 8 ? 8 : f >= 4 ? 4 : f >= 2 ? 2 : 1;
  return m * p;
}

export function scaleBarLayout(metersPerPixel: number, maxWidth: number, unit: ScaleBarUnit): ScaleBarLayout | null {
  if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) return null;
  const maxMeters = metersPerPixel * maxWidth;
  let perUnit: number; // 每顯示單位有幾公尺
  let unitLabel: string;
  if (unit === 'metric') {
    [perUnit, unitLabel] = maxMeters >= 1000 ? [1000, 'km'] : [1, 'm'];
  } else {
    const maxFeet = maxMeters * FEET_PER_METER;
    [perUnit, unitLabel] = maxFeet >= FEET_PER_MILE ? [FEET_PER_MILE / FEET_PER_METER, 'mi'] : [1 / FEET_PER_METER, 'ft'];
  }
  const total = niceTotal(maxMeters / perUnit);
  return { width: (total * perUnit) / metersPerPixel, total, unitLabel };
}

/** 刻度數字：去掉浮點誤差 */
export function formatScaleNumber(v: number): string {
  return String(Number(v.toPrecision(6)));
}
