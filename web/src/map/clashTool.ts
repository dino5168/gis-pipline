// 衝突檢核：在 2D 地圖上畫規劃管線（單擊加點，雙擊或 Enter 完成，Backspace 退一點，Esc 取消），
// 並標出疑似衝突的位置（依嚴重度配色）與目前指到的那一筆。
// 標籤（起、終、長度）用 Marker（樣式沒有 glyphs，無法用 symbol 文字）。
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Feature } from 'geojson';
import { formatDistance, segmentLengths } from './measure';
import { CLASH_MAX_LENGTH, CLASH_MAX_POINTS } from '../config';
import type { LngLat } from '../types/profile';

const SOURCE_ID = 'clash';
const LAYER_CASING = 'clash-line-casing';
const LAYER_LINE = 'clash-line';
const LAYER_VERTEX = 'clash-vertex';
const LAYER_POINT = 'clash-point';
const LAYER_HIGHLIGHT = 'clash-highlight';
const LINE_COLOR = '#4dabf7';
const TOO_LONG_COLOR = '#ff6b6b';
const HALO_COLOR = '#10212d';
const LABEL_CLASS =
  'pointer-events-none rounded bg-card/90 px-1.5 py-0.5 font-mono text-xs text-foreground tabular-nums shadow-sm';

/** 地圖上要標的衝突位置 */
export interface ClashMapPoint {
  at: LngLat;
  color: string;
}

interface Options {
  /** 畫完規劃管線 */
  onComplete: (line: LngLat[]) => void;
  /** 畫線途中按 Esc */
  onCancel: () => void;
}

export class ClashTool {
  private drawing = false;
  private pts: LngLat[] = [];
  private cursor: LngLat | null = null;
  private line: LngLat[] | null = null;
  private points: ClashMapPoint[] = [];
  private highlight: number | null = null;
  private labels: maplibregl.Marker[] = [];
  private readonly map: maplibregl.Map;
  private readonly opts: Options;

  constructor(map: maplibregl.Map, opts: Options) {
    this.map = map;
    this.opts = opts;
    if (map.isStyleLoaded()) this.addLayers();
    else map.once('load', () => this.addLayers());
  }

  /** 畫線中（其他點選功能應暫停） */
  get active(): boolean {
    return this.drawing;
  }

  /** 開始畫新的規劃管線（清掉舊的） */
  startDrawing(): void {
    this.clear();
    this.drawing = true;
    this.map.on('click', this.handleClick);
    this.map.on('dblclick', this.handleDblClick);
    this.map.on('mousemove', this.handleMove);
    window.addEventListener('keydown', this.handleKey);
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /** 停止畫線；保留已完成的規劃管線 */
  stopDrawing(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.pts = [];
    this.cursor = null;
    this.map.off('click', this.handleClick);
    this.map.off('dblclick', this.handleDblClick);
    this.map.off('mousemove', this.handleMove);
    window.removeEventListener('keydown', this.handleKey);
    // 延後恢復雙擊縮放：完成用的雙擊不要觸發縮放
    setTimeout(() => this.map.doubleClickZoom.enable(), 400);
    this.map.getCanvas().style.cursor = '';
    this.render();
  }

  /** 清除規劃管線與衝突標示（並停止畫線） */
  clear(): void {
    this.stopDrawing();
    this.line = null;
    this.points = [];
    this.highlight = null;
    this.render();
  }

  /** 直接設定規劃管線（命令列 CLASH 輸入的各點） */
  setLine(line: LngLat[]): void {
    this.clear();
    this.line = line;
    this.render();
  }

  setPoints(points: ClashMapPoint[]): void {
    this.points = points;
    this.highlight = null;
    this.render();
  }

  /** 醒目標示第 i 個衝突（null＝取消） */
  setHighlight(i: number | null): void {
    if (i === this.highlight) return;
    this.highlight = i;
    this.render();
  }

  destroy(): void {
    this.stopDrawing();
    this.clearLabels();
  }

  // ---- 事件
  private finish() {
    if (this.pts.length < 2) return;
    const line = [...this.pts];
    this.line = line;
    this.stopDrawing();
    this.opts.onComplete(line);
  }

  private handleClick = (e: maplibregl.MapMouseEvent) => {
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const last = this.pts[this.pts.length - 1];
    if (last) {
      const q = this.map.project(last);
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) < 4) return; // 同一點（雙擊的第二下）
    }
    this.pts.push(p);
    this.cursor = p;
    if (this.pts.length >= CLASH_MAX_POINTS) this.finish();
    else this.render();
  };

  private handleDblClick = (e: maplibregl.MapMouseEvent) => {
    e.preventDefault();
    this.finish();
  };

  private handleMove = (e: maplibregl.MapMouseEvent) => {
    if (!this.pts.length) return;
    this.cursor = [e.lngLat.lng, e.lngLat.lat];
    this.render();
  };

  private handleKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      this.stopDrawing();
      this.opts.onCancel();
    } else if (e.key === 'Enter') {
      this.finish();
    } else if (e.key === 'Backspace' && this.pts.length) {
      e.preventDefault();
      this.pts.pop();
      this.render();
    }
  };

  // ---- 繪製
  private addLayers() {
    const map = this.map;
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const isLine: maplibregl.FilterSpecification = ['==', ['geometry-type'], 'LineString'];
    map.addLayer({
      id: LAYER_CASING,
      type: 'line',
      source: SOURCE_ID,
      filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': HALO_COLOR, 'line-width': 6, 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], LINE_COLOR], 'line-width': 3 },
    });
    map.addLayer({
      id: LAYER_VERTEX,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['get', 'vertex']],
      paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-color': LINE_COLOR, 'circle-stroke-width': 1.5 },
    });
    map.addLayer({
      id: LAYER_POINT,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['get', 'vertex']], ['!', ['get', 'hl']]],
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': HALO_COLOR,
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: LAYER_HIGHLIGHT,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['get', 'hl']],
      paint: {
        'circle-radius': 9,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    this.render();
  }

  private render() {
    const src = this.map.getSource<GeoJSONSource>(SOURCE_ID);
    const coords: LngLat[] =
      this.line ?? (this.pts.length && this.cursor ? [...this.pts, this.cursor] : [...this.pts]);
    const features: Feature[] = [];
    const length = coords.length >= 2 ? segmentLengths(coords).reduce((a, b) => a + b, 0) : 0;
    const tooLong = length > CLASH_MAX_LENGTH;
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: tooLong ? { color: TOO_LONG_COLOR } : {},
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
    for (const p of this.line ?? this.pts) {
      features.push({ type: 'Feature', properties: { vertex: true }, geometry: { type: 'Point', coordinates: p } });
    }
    this.points.forEach((p, i) => {
      features.push({
        type: 'Feature',
        properties: { color: p.color, hl: i === this.highlight, vertex: false },
        geometry: { type: 'Point', coordinates: p.at },
      });
    });
    src?.setData({ type: 'FeatureCollection', features });

    this.clearLabels();
    if (coords.length) this.addLabel(coords[0], '起');
    if (coords.length >= 2) {
      const end = coords[coords.length - 1];
      const over = tooLong ? `（超過 ${CLASH_MAX_LENGTH} m）` : '';
      this.addLabel(end, `${this.line ? '終 ' : ''}${formatDistance(length)}${over}`);
    }
  }

  private addLabel(at: LngLat, text: string) {
    const el = document.createElement('div');
    el.className = LABEL_CLASS;
    el.textContent = text;
    this.labels.push(new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [4, -6] }).setLngLat(at).addTo(this.map));
  }

  private clearLabels() {
    for (const m of this.labels) m.remove();
    this.labels = [];
  }
}
