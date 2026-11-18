// 2D 量測工具：在 MapLibre 地圖上量距離／面積（單擊加點、雙擊結束）、正方形／圓形（單擊兩下：起點與終點）。
// 量測圖形用 GeoJSON source＋圖層畫在最上層；數值標籤用 Marker（樣式沒有 glyphs，無法用 symbol 文字）。
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Feature } from 'geojson';
import {
  circleFromCenter,
  formatArea,
  formatDistance,
  midpoint,
  polygonArea,
  polygonLabelPoint,
  segmentLengths,
  squareFromCorner,
  type LngLat,
  type MeasureResult,
} from './measure';
import { DEFAULT_MEASURE_STYLE, MEASURE_DASHARRAY, isTwoPointMode, type MeasureMode, type MeasureStyle } from '../types/measure';

const SOURCE_ID = 'measure';
const LAYER_FILL = 'measure-fill';
const LAYER_CASING = 'measure-line-casing';
const LAYER_LINE = 'measure-line';
const LAYER_VERTEX = 'measure-vertex';
const LAYER_ARROW = 'measure-arrow';
const ARROW_IMAGE = 'measure-arrow';
const HALO_COLOR = '#10212d';
/** 新點與前一點在螢幕上距離小於此值（px）視為同一點（雙擊會先觸發兩次 click） */
const SAME_POINT_PX = 4;

/** 標籤樣式（逐段標籤不換行） */
const LABEL_CLASS =
  'pointer-events-none rounded bg-card/90 px-1.5 py-0.5 font-mono text-xs text-foreground tabular-nums shadow-sm';

interface Label {
  at: LngLat;
  text: string;
  anchor?: maplibregl.PositionAnchor;
  strong?: boolean;
}

/** 一次繪製的內容 */
interface Shape {
  polygon?: LngLat[];
  line?: LngLat[];
  /** 方向箭頭：位置與方位角（度，正北順時針） */
  arrows?: { at: LngLat; bearing: number }[];
  labels: Label[];
  lengthM: number;
  areaM2: number;
  sizeM: number;
}

interface Options {
  /** 量測結果變化（null＝沒有量測中或已清除） */
  onChange: (result: MeasureResult | null) => void;
  /** 使用者按 Esc 要求結束量測 */
  onExit: () => void;
}

export class MeasureTool {
  private mode: MeasureMode | null = null;
  private points: LngLat[] = [];
  private cursor: LngLat | null = null;
  private drawing = false;
  private labels: maplibregl.Marker[] = [];
  private style: MeasureStyle = DEFAULT_MEASURE_STYLE;
  private readonly map: maplibregl.Map;
  private readonly opts: Options;

  constructor(map: maplibregl.Map, opts: Options) {
    this.map = map;
    this.opts = opts;
    if (map.isStyleLoaded()) this.addLayers();
    else map.once('load', () => this.addLayers());
  }

  /** 量測中（其他點選功能，例如管線屬性，應暫停） */
  get active(): boolean {
    return this.mode !== null;
  }

  /** 切換模式；null＝關閉量測並清除結果。切換模式會清除舊結果 */
  setMode(mode: MeasureMode | null): void {
    if (mode === this.mode) return;
    const wasActive = this.active;
    this.mode = mode;
    this.reset();
    if (mode && !wasActive) this.attach();
    else if (!mode && wasActive) this.detach();
    this.render();
  }

  /** 套用樣式（設定 → 樣式）；只改 paint／layout，不重建圖層 */
  setStyle(style: MeasureStyle): void {
    this.style = style;
    if (this.map.getLayer(LAYER_LINE)) this.applyStyle();
  }

  destroy(): void {
    if (this.active) this.detach();
    this.clearLabels();
  }

  // ---- 事件
  private attach() {
    this.map.on('click', this.handleClick);
    this.map.on('dblclick', this.handleDblClick);
    this.map.on('mousemove', this.handleMove);
    this.map.getCanvasContainer().addEventListener('mouseleave', this.handleLeave);
    window.addEventListener('keydown', this.handleKey);
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  private detach() {
    this.map.off('click', this.handleClick);
    this.map.off('dblclick', this.handleDblClick);
    this.map.off('mousemove', this.handleMove);
    this.map.getCanvasContainer().removeEventListener('mouseleave', this.handleLeave);
    window.removeEventListener('keydown', this.handleKey);
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
  }

  private handleClick = (e: maplibregl.MapMouseEvent) => {
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (!this.drawing) {
      // 上一次已結束（或剛開始）：清掉舊結果，開始新的量測
      this.reset();
      this.drawing = true;
    }
    const last = this.points[this.points.length - 1];
    if (last) {
      const q = this.map.project(last);
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) < SAME_POINT_PX) return;
    }
    this.points.push(p);
    this.cursor = p;
    // 正方形／圓形：第二點即結束
    if (this.mode && isTwoPointMode(this.mode) && this.points.length === 2) {
      this.drawing = false;
      this.cursor = null;
    }
    this.render();
  };

  private handleDblClick = (e: maplibregl.MapMouseEvent) => {
    e.preventDefault();
    if (!this.drawing || !this.mode || isTwoPointMode(this.mode)) return;
    const need = this.mode === 'area' ? 3 : 2;
    if (this.points.length < need) return; // 點不夠，繼續加點
    this.drawing = false;
    this.cursor = null;
    this.render();
  };

  private handleMove = (e: maplibregl.MapMouseEvent) => {
    if (!this.drawing) return;
    this.cursor = [e.lngLat.lng, e.lngLat.lat];
    this.render();
  };

  private handleLeave = () => {
    if (!this.drawing) return;
    this.cursor = null;
    this.render();
  };

  private handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.opts.onExit();
  };

  // ---- 狀態與繪製
  private reset() {
    this.points = [];
    this.cursor = null;
    this.drawing = false;
  }

  /** 目前要畫的點：已確定的點＋跟著滑鼠的那一點 */
  private livePoints(): LngLat[] {
    const pts = [...this.points];
    if (this.drawing && this.cursor) {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== this.cursor[0] || last[1] !== this.cursor[1]) pts.push(this.cursor);
    }
    return pts;
  }

  private render() {
    const pts = this.livePoints();
    const shape = this.mode ? this.compute(this.mode, pts) : null;
    const features: Feature[] = [];
    if (shape?.polygon) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...shape.polygon, shape.polygon[0]]] } });
    }
    if (shape?.line) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: shape.line } });
    }
    for (const p of this.points) {
      features.push({ type: 'Feature', properties: { kind: 'vertex' }, geometry: { type: 'Point', coordinates: p } });
    }
    for (const a of shape?.arrows ?? []) {
      features.push({
        type: 'Feature',
        properties: { kind: 'arrow', bearing: a.bearing },
        geometry: { type: 'Point', coordinates: a.at },
      });
    }
    const src = this.map.getSource<GeoJSONSource>(SOURCE_ID);
    src?.setData({ type: 'FeatureCollection', features });

    this.clearLabels();
    for (const l of shape?.labels ?? []) this.addLabel(l.at, l.text, l.anchor, l.strong);
    this.opts.onChange(
      this.mode
        ? {
            mode: this.mode,
            pointCount: this.points.length,
            drawing: this.drawing,
            lengthM: shape?.lengthM ?? 0,
            areaM2: shape?.areaM2 ?? 0,
            sizeM: shape?.sizeM ?? 0,
          }
        : null,
    );
  }

  /** 依模式算出要畫的圖形、標籤與數值；pts＝已確定的點＋跟著滑鼠的點 */
  private compute(mode: MeasureMode, pts: LngLat[]): Shape | null {
    if (pts.length < 2) return null;
    const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);
    switch (mode) {
      case 'distance': {
        const segs = segmentLengths(pts);
        const total = sum(segs);
        const labels: Label[] = [];
        // 多於一段時才逐段標示，否則和總長重複
        // 段長標籤放在箭頭上方，避免蓋住箭頭
        if (segs.length > 1) {
          segs.forEach((len, i) => labels.push({ at: midpoint(pts[i], pts[i + 1]), text: formatDistance(len), anchor: 'bottom' }));
        }
        const arrows = edgeArrows(pts, false);
        labels.push({ at: pts[pts.length - 1], text: `總長 ${formatDistance(total)}`, anchor: 'left', strong: true });
        return { line: pts, arrows, labels, lengthM: total, areaM2: 0, sizeM: 0 };
      }
      case 'area': {
        if (pts.length < 3) {
          return { line: pts, arrows: edgeArrows(pts, false), labels: [], lengthM: sum(segmentLengths(pts)), areaM2: 0, sizeM: 0 };
        }
        const perimeter = sum(segmentLengths(pts, true));
        const area = polygonArea(pts);
        const text = `面積 ${formatArea(area)}
周長 ${formatDistance(perimeter)}`;
        return {
          polygon: pts,
          arrows: edgeArrows(pts, true), // 含最後一點回到起點的邊
          labels: [{ at: polygonLabelPoint(pts), text, strong: true }],
          lengthM: perimeter,
          areaM2: area,
          sizeM: 0,
        };
      }
      case 'square': {
        const { ring, side } = squareFromCorner(pts[0], pts[1]);
        const area = side * side;
        const text = `邊長 ${formatDistance(side)}
面積 ${formatArea(area)}
周長 ${formatDistance(4 * side)}`;
        return {
          polygon: ring,
          labels: [{ at: midpoint(ring[0], ring[2]), text, strong: true }],
          lengthM: 4 * side,
          areaM2: area,
          sizeM: side,
        };
      }
      case 'circle': {
        const { ring, radius } = circleFromCenter(pts[0], pts[1]);
        const area = Math.PI * radius * radius;
        const text = `半徑 ${formatDistance(radius)}
面積 ${formatArea(area)}
周長 ${formatDistance(2 * Math.PI * radius)}`;
        return {
          polygon: ring,
          line: [pts[0], pts[1]], // 半徑線
          labels: [{ at: pts[0], text, anchor: 'top', strong: true }],
          lengthM: 2 * Math.PI * radius,
          areaM2: area,
          sizeM: radius,
        };
      }
    }
  }

  private clearLabels() {
    for (const m of this.labels) m.remove();
    this.labels = [];
  }

  private addLabel(at: LngLat, text: string, anchor: maplibregl.PositionAnchor = 'center', strong = false) {
    const el = document.createElement('div');
    // whitespace-pre：結果標籤以換行分多行
    el.className = strong ? `${LABEL_CLASS} whitespace-pre font-semibold ring-1 ring-primary/60` : `${LABEL_CLASS} whitespace-nowrap`;
    el.textContent = text;
    const offset: [number, number] =
      anchor === 'left' ? [10, 0] : anchor === 'top' ? [0, 10] : anchor === 'bottom' ? [0, -10] : [0, 0];
    const marker = new maplibregl.Marker({ element: el, anchor, offset })
      .setLngLat(at)
      .addTo(this.map);
    this.labels.push(marker);
  }

  private addLayers() {
    if (this.map.getSource(SOURCE_ID)) return;
    this.map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // 不指定 beforeId：疊在所有圖層（含管線）之上
    this.map.addLayer({
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': this.style.color, 'fill-opacity': this.style.fillOpacity },
    });
    this.map.addLayer({
      id: LAYER_CASING,
      type: 'line',
      source: SOURCE_ID,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': HALO_COLOR, 'line-width': casingWidth(this.style.lineWidth), 'line-opacity': 0.6 },
    });
    this.map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': this.style.color, 'line-width': this.style.lineWidth },
    });
    this.map.addLayer({
      id: LAYER_VERTEX,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': this.style.color,
        'circle-stroke-width': 2,
      },
    });
    if (!this.map.hasImage(ARROW_IMAGE)) this.map.addImage(ARROW_IMAGE, arrowImage(this.style.color), { pixelRatio: 2 });
    this.map.addLayer({
      id: LAYER_ARROW,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'arrow'],
      layout: {
        'icon-image': ARROW_IMAGE,
        'icon-rotate': ['get', 'bearing'],
        // 方位角以正北為準，地圖旋轉時箭頭跟著線段轉
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    this.applyStyle();
    this.render();
  }

  private applyStyle() {
    const { color, lineStyle, lineWidth, fillOpacity, showArrows } = this.style;
    const m = this.map;
    m.setPaintProperty(LAYER_FILL, 'fill-color', color);
    m.setPaintProperty(LAYER_FILL, 'fill-opacity', fillOpacity);
    m.setPaintProperty(LAYER_CASING, 'line-width', casingWidth(lineWidth));
    m.setPaintProperty(LAYER_LINE, 'line-color', color);
    m.setPaintProperty(LAYER_LINE, 'line-width', lineWidth);
    // undefined＝回到預設（實線）
    m.setPaintProperty(LAYER_LINE, 'line-dasharray', MEASURE_DASHARRAY[lineStyle]);
    m.setPaintProperty(LAYER_VERTEX, 'circle-stroke-color', color);
    m.setLayoutProperty(LAYER_ARROW, 'visibility', showArrows ? 'visible' : 'none');
    if (m.hasImage(ARROW_IMAGE)) m.updateImage(ARROW_IMAGE, arrowImage(color));
  }
}

/** 每條邊中點的方向箭頭（依點的順序）；closed 時含最後一點回到起點的邊 */
function edgeArrows(pts: readonly LngLat[], closed: boolean): { at: LngLat; bearing: number }[] {
  const out = pts.slice(1).map((b, i) => ({ at: midpoint(pts[i], b), bearing: screenBearing(pts[i], b) }));
  if (closed && pts.length >= 3) {
    const a = pts[pts.length - 1];
    out.push({ at: midpoint(a, pts[0]), bearing: screenBearing(a, pts[0]) });
  }
  return out;
}

/** 線段 a→b 在 Web Mercator（畫面）上的方位角（度，正北順時針），讓箭頭與畫出來的線段同方向 */
function screenBearing(a: LngLat, b: LngLat): number {
  const p = maplibregl.MercatorCoordinate.fromLngLat(a);
  const q = maplibregl.MercatorCoordinate.fromLngLat(b);
  // Mercator y 往南增加
  return (Math.atan2(q.x - p.x, p.y - q.y) * 180) / Math.PI;
}

/** 外框（深色描邊）線寬：比量測線寬一點 */
function casingWidth(lineWidth: number): number {
  return lineWidth + 2.5;
}

/** 箭頭圖示（朝上＝正北）：量測顏色帶倒鉤的箭頭，外加深色描邊；32px、pixelRatio 2 → 畫面 16px */
function arrowImage(color: string): ImageData {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(16, 4); // 尖端
  ctx.lineTo(26, 26);
  ctx.lineTo(16, 20); // 倒鉤凹口
  ctx.lineTo(6, 26);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO_COLOR;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
