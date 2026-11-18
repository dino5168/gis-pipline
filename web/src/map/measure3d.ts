// 3D 量測的計算與文字格式（不依賴 Cesium，可放主 bundle）。
// 水平距離／面積沿用 2D 的 TWD97 TM2 平面坐標計算；高度為實際尺寸（已換算掉放大倍率）。
import { segmentLengths } from './measure';
import type { HeightMode } from '../types/pipe3d';
import type { MeasurePoint3D } from '../types/measure3d';

const fmt = (v: number, digits: number) =>
  v.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 一段的水平距離、高差、斜距（公尺） */
export function segment3D(a: MeasurePoint3D, b: MeasurePoint3D): { horizontal: number; dh: number; slant: number } {
  const horizontal = segmentLengths([
    [a.lng, a.lat],
    [b.lng, b.lat],
  ])[0];
  const dh = b.h - a.h;
  return { horizontal, dh, slant: Math.hypot(horizontal, dh) };
}

/** 高度文字：埋深模式「地表下 1.23 m」；Z 模式「高程 5.67 m」 */
export function formatHeight(h: number, mode: HeightMode): string {
  if (mode === 'z') return `高程 ${fmt(h, 2)} m`;
  if (Math.abs(h) < 0.005) return '地表 0.00 m';
  return h < 0 ? `地表下 ${fmt(-h, 2)} m` : `地表上 ${fmt(h, 2)} m`;
}

/** 高差文字：+1.23 m（上升）／−1.23 m（下降） */
export function formatDh(dh: number): string {
  return `${dh >= 0 ? '+' : '−'}${fmt(Math.abs(dh), 2)} m`;
}
