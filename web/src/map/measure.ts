// 量測計算：經緯度轉 TWD97 TM2（EPSG:3826）後以平面坐標計算距離與面積。
// 與管線資料、坐標顯示同一套坐標系；適用台灣本島（121° 分帶）。
import { lngLatToTwd97, twd97ToLngLat } from './coordTransform';
import type { MeasureMode } from '../types/measure';

export type LngLat = [number, number];

const toXY = (p: LngLat) => lngLatToTwd97(p[0], p[1]);

/** 各段長度（公尺）；closed 為 true 時含最後一點回到起點的那段 */
export function segmentLengths(points: readonly LngLat[], closed = false): number[] {
  const xy = points.map(toXY);
  const out: number[] = [];
  for (let i = 1; i < xy.length; i++) out.push(Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  if (closed && xy.length >= 3) {
    const a = xy[xy.length - 1];
    out.push(Math.hypot(xy[0][0] - a[0], xy[0][1] - a[1]));
  }
  return out;
}

/** 多邊形面積（平方公尺，鞋帶公式取絕對值；邊自我交叉時結果無意義） */
export function polygonArea(points: readonly LngLat[]): number {
  if (points.length < 3) return 0;
  const xy = points.map(toXY);
  // 以第一點為原點減少大數相減的誤差
  const [ox, oy] = xy[0];
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    s += (x1 - ox) * (y2 - oy) - (x2 - ox) * (y1 - oy);
  }
  return Math.abs(s) / 2;
}

/** 多邊形標籤位置：面積加權重心，退化時改用頂點平均 */
export function polygonLabelPoint(points: readonly LngLat[]): LngLat {
  const n = points.length;
  const [ox, oy] = points[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const x1 = points[i][0] - ox;
    const y1 = points[i][1] - oy;
    const x2 = points[(i + 1) % n][0] - ox;
    const y2 = points[(i + 1) % n][1] - oy;
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-14) {
    const sum = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

/** 圓形近似多邊形的邊數 */
const CIRCLE_SEGMENTS = 128;

/**
 * 正方形：以 a 為一角、往 b 的方向，邊長取 TWD97 坐標 x、y 差較大者，邊與 TWD97 坐標軸（約正北）平行。
 * 回傳四個角（a 為第一點）與邊長（公尺）。
 */
export function squareFromCorner(a: LngLat, b: LngLat): { ring: LngLat[]; side: number } {
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const side = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const sx = (bx >= ax ? 1 : -1) * side;
  const sy = (by >= ay ? 1 : -1) * side;
  const ring: LngLat[] = [
    a,
    twd97ToLngLat(ax + sx, ay),
    twd97ToLngLat(ax + sx, ay + sy),
    twd97ToLngLat(ax, ay + sy),
  ];
  return { ring, side };
}

/** 圓形：以 center 為圓心、到 edge 的 TWD97 距離為半徑，回傳近似多邊形（不閉合）與半徑（公尺） */
export function circleFromCenter(center: LngLat, edge: LngLat): { ring: LngLat[]; radius: number } {
  const [cx, cy] = toXY(center);
  const [ex, ey] = toXY(edge);
  const radius = Math.hypot(ex - cx, ey - cy);
  const ring: LngLat[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    ring.push(twd97ToLngLat(cx + radius * Math.cos(t), cy + radius * Math.sin(t)));
  }
  return { ring, radius };
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const fmt = (v: number, digits: number) =>
  v.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 距離：未滿 1,000 m 顯示 m（2 位小數），以上顯示 km（3 位小數） */
export function formatDistance(m: number): string {
  return m < 1000 ? `${fmt(m, 2)} m` : `${fmt(m / 1000, 3)} km`;
}

/** 面積：未滿 1 公頃顯示 m²；未滿 1 km² 加註公頃；以上顯示 km² 並加註公頃 */
export function formatArea(m2: number): string {
  if (m2 < 10_000) return `${fmt(m2, 2)} m²`;
  if (m2 < 1_000_000) return `${fmt(m2, 0)} m²（${fmt(m2 / 10_000, 2)} 公頃）`;
  return `${fmt(m2 / 1_000_000, 3)} km²（${fmt(m2 / 10_000, 1)} 公頃）`;
}

/** 量測結果（給畫面上的結果面板） */
export interface MeasureResult {
  mode: MeasureMode;
  /** 已確定的點數（不含跟著滑鼠的那一點） */
  pointCount: number;
  /** 還在加點中（尚未雙擊結束） */
  drawing: boolean;
  /** 距離：總長；其他：周長（公尺） */
  lengthM: number;
  /** 面積（平方公尺），距離量測為 0 */
  areaM2: number;
  /** 正方形：邊長；圓形：半徑（公尺）；其他為 0 */
  sizeM: number;
}
