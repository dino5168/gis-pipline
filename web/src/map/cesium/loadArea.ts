// 3D 管線的載入範圍：一次載入比畫面大一圈的範圍，畫面還在範圍內就不重抓。
import { PIPE3D_LOAD_MARGIN, PIPE3D_MAX_SPAN } from '../../config';

/** [west, south, east, north]（度） */
export type Bbox = [number, number, number, number];

/** 一種管線已載入的範圍 */
export interface LoadedArea {
  bbox: Bbox;
  /** 載入時的畫面中心（API 依離 bbox 中心的距離取前 N 筆） */
  center: [number, number];
  /** 是否達筆數上限（只載入到中心附近） */
  truncated: boolean;
}

/** 以中心為準，限制在 PIPE3D_MAX_SPAN 內 */
function clampSpan([w, s, e, n]: Bbox, [lng, lat]: [number, number]): Bbox {
  const half = PIPE3D_MAX_SPAN / 2 - 1e-6;
  return [Math.max(w, lng - half), Math.max(s, lat - half), Math.min(e, lng + half), Math.min(n, lat + half)];
}

/** 畫面範圍限制在最大跨度內（判斷是否需要重抓用） */
export function visibleArea(view: Bbox, center: [number, number]): Bbox {
  return clampSpan(view, center);
}

/** 要向 API 載入的範圍：畫面範圍四周各外擴 PIPE3D_LOAD_MARGIN 倍，再限制在最大跨度內 */
export function loadArea(view: Bbox, center: [number, number]): Bbox {
  const [w, s, e, n] = clampSpan(view, center);
  const mx = (e - w) * PIPE3D_LOAD_MARGIN, my = (n - s) * PIPE3D_LOAD_MARGIN;
  return clampSpan([w - mx, s - my, e + mx, n + my], center);
}

export const bboxParam = (b: Bbox) => b.map((x) => x.toFixed(6)).join(',');

/**
 * 已載入的範圍是否還涵蓋目前畫面：畫面在範圍內即可（旋轉、拉近都不重抓）。
 * 達筆數上限時只有載入中心附近有資料，畫面中心離載入中心超過畫面寬高的 1/4 就重抓。
 */
export function covers(area: LoadedArea, visible: Bbox, center: [number, number]): boolean {
  const [w, s, e, n] = area.bbox;
  const [vw, vs, ve, vn] = visible;
  if (vw < w || vs < s || ve > e || vn > n) return false;
  if (!area.truncated) return true;
  return Math.abs(center[0] - area.center[0]) <= (ve - vw) / 4 && Math.abs(center[1] - area.center[1]) <= (vn - vs) / 4;
}
