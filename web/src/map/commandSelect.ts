// 命令列的物件選取（仿 AutoCAD）：在螢幕像素坐標上判斷。
//   單擊：選最近的點／線／多邊形邊（容許 PICK_TOLERANCE_PX）；都沒有時選滑鼠所在的多邊形（最上層）
//   框選：左 → 右＝視窗（圖形整個在框內）；右 → 左＝框選穿越（碰到框就算）
import type { LineString, Point, Polygon, Position } from 'geojson';

type FeatureId = string | number;
export type Px = [number, number];

export interface Shape {
  id: FeatureId;
  geometry: Point | LineString | Polygon;
}

export type Project = (lngLat: Position) => Px;

export const PICK_TOLERANCE_PX = 6;

/** 圖形的各條點串（多邊形為各環）；點回傳單點 */
function parts(g: Shape['geometry'], project: Project): Px[][] {
  if (g.type === 'Point') return [[project(g.coordinates)]];
  if (g.type === 'LineString') return [g.coordinates.map(project)];
  return g.coordinates.map((r) => r.map(project));
}

function segDist(p: Px, a: Px, b: Px): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inRing(p: Px, ring: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inPolygon(p: Px, rings: Px[][]): boolean {
  return inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h));
}

/** 單擊選取：回傳圖形 id，沒有則 null */
export function pickShape(shapes: Shape[], project: Project, p: Px, tol = PICK_TOLERANCE_PX): FeatureId | null {
  let best: FeatureId | null = null;
  let bestD = tol;
  for (const s of shapes) {
    for (const pts of parts(s.geometry, project)) {
      const d = pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) : Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));
      if (d <= bestD) {
        bestD = d;
        best = s.id;
      }
    }
  }
  if (best !== null) return best;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const g = shapes[i].geometry;
    if (g.type === 'Polygon' && inPolygon(p, g.coordinates.map((r) => r.map(project)))) return shapes[i].id;
  }
  return null;
}

function cross(o: Px, a: Px, b: Px) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsIntersect(a: Px, b: Px, c: Px, d: Px): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 框選：a、b 為兩個角（螢幕像素）；crossing＝框選穿越 */
export function windowSelect(shapes: Shape[], project: Project, a: Px, b: Px, crossing: boolean): FeatureId[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const inside = (p: Px) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const box: Px[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const boxEdges = box.map((p, i) => [p, box[(i + 1) % 4]] as const);

  return shapes
    .filter((s) => {
      const ps = parts(s.geometry, project);
      if (!crossing) return ps.every((pts) => pts.every(inside));
      if (ps.some((pts) => pts.some(inside))) return true;
      if (ps.some((pts) => pts.slice(1).some((q, i) => boxEdges.some(([c, d]) => segmentsIntersect(pts[i], q, c, d))))) {
        return true;
      }
      // 框整個在多邊形裡
      return s.geometry.type === 'Polygon' && inPolygon(box[0], ps);
    })
    .map((s) => s.id);
}
