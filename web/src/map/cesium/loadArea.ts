// 3D 管線的載入範圍：以 2D 畫面範圍為準（與 2D 顯示的管線一致），換算成固定格網（Web Mercator 圖磚編號）。
// 格子網址固定，瀏覽器／Nginx 可快取；同一格不重抓。
import { PIPE3D_MAX_SPAN, PIPE3D_TILE_MARGIN } from '../../config';

/** [west, south, east, north]（度） */
export type Bbox = [number, number, number, number];

export interface TileXY {
  x: number;
  y: number;
}

export const tileKey = (t: TileXY) => `${t.x}/${t.y}`;

/** 經緯度 → 圖磚座標（小數，整數部分即圖磚編號） */
function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n];
}

/** 以中心為準，限制在 PIPE3D_MAX_SPAN 內（避免 2D 傾斜／超大螢幕時一次要太多格） */
function clampSpan([w, s, e, n]: Bbox, [lng, lat]: [number, number]): Bbox {
  const half = PIPE3D_MAX_SPAN / 2;
  return [Math.max(w, lng - half), Math.max(s, lat - half), Math.min(e, lng + half), Math.min(n, lat + half)];
}

/** 涵蓋畫面範圍（外擴 PIPE3D_TILE_MARGIN）的格子，依離畫面中心由近到遠排序 */
export function tilesForView(view: Bbox, center: [number, number], z: number): TileXY[] {
  const m = PIPE3D_TILE_MARGIN;
  const [w, s, e, n] = clampSpan([view[0] - m, view[1] - m, view[2] + m, view[3] + m], center);
  const [x0, y0] = lngLatToTile(w, n, z);
  const [x1, y1] = lngLatToTile(e, s, z);
  const [cx, cy] = lngLatToTile(center[0], center[1], z);
  const tiles: (TileXY & { d: number })[] = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      tiles.push({ x, y, d: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 });
    }
  }
  return tiles.sort((a, b) => a.d - b.d).map(({ x, y }) => ({ x, y }));
}
