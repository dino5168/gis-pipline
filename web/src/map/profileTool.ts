// 剖面分析：在 2D 地圖上畫剖面線（單擊起點 A、單擊終點 B，Esc 取消），並標出交點與目前指到的管線。
// 標籤（A／B、長度）用 Marker（樣式沒有 glyphs，無法用 symbol 文字）。
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Feature } from 'geojson';
import { formatDistance, midpoint, segmentLengths } from './measure';
import { PROFILE_MAX_LENGTH } from '../config';
import type { LngLat } from '../types/profile';

const SOURCE_ID = 'profile';
const LAYER_CASING = 'profile-line-casing';
const LAYER_LINE = 'profile-line';
const LAYER_POINT = 'profile-point';
const LAYER_HIGHLIGHT = 'profile-highlight';
const LINE_COLOR = '#ffd43b';
const HALO_COLOR = '#10212d';
const LABEL_CLASS =
  'pointer-events-none rounded bg-card/90 px-1.5 py-0.5 font-mono text-xs text-foreground tabular-nums shadow-sm';

/** 地圖上要標的交點 */
export interface ProfileMapPoint {
  at: LngLat;
  color: string;
}

interface Options {
  /** 畫完剖面線（A、B 兩點） */
  onComplete: (line: [LngLat, LngLat]) => void;
  /** 畫線途中按 Esc */
  onCancel: () => void;
}

export class ProfileTool {
  private drawing = false;
  private start: LngLat | null = null;
  private cursor: LngLat | null = null;
  private line: [LngLat, LngLat] | null = null;
  private points: ProfileMapPoint[] = [];
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

  /** 開始畫新的剖面線（清掉舊的） */
  startDrawing(): void {
    this.clear();
    this.drawing = true;
    this.map.on('click', this.handleClick);
    this.map.on('mousemove', this.handleMove);
    window.addEventListener('keydown', this.handleKey);
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /** 停止畫線；保留已畫好的剖面線 */
  stopDrawing(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.start = null;
    this.cursor = null;
    this.map.off('click', this.handleClick);
    this.map.off('mousemove', this.handleMove);
    window.removeEventListener('keydown', this.handleKey);
    // 延後恢復雙擊縮放：第二次單擊緊接的 dblclick 不要觸發縮放
    setTimeout(() => this.map.doubleClickZoom.enable(), 400);
    this.map.getCanvas().style.cursor = '';
    this.render();
  }

  /** 清除剖面線與交點（並停止畫線） */
  clear(): void {
    this.stopDrawing();
    this.line = null;
    this.points = [];
    this.highlight = null;
    this.render();
  }

  setPoints(points: ProfileMapPoint[]): void {
    this.points = points;
    this.highlight = null;
    this.render();
  }

  /** 醒目標示第 i 個交點（null＝取消） */
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
  private handleClick = (e: maplibregl.MapMouseEvent) => {
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (!this.start) {
      this.start = p;
      this.cursor = p;
      this.render();
      return;
    }
    const q = this.map.project(this.start);
    if (Math.hypot(q.x - e.point.x, q.y - e.point.y) < 4) return; // 同一點（連點兩下）
    const line: [LngLat, LngLat] = [this.start, p];
    this.line = line;
    this.stopDrawing();
    this.opts.onComplete(line);
  };

  private handleMove = (e: maplibregl.MapMouseEvent) => {
    if (!this.start) return;
    this.cursor = [e.lngLat.lng, e.lngLat.lat];
    this.render();
  };

  private handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.stopDrawing();
      this.opts.onCancel();
    }
  };

  // ---- 繪製
  private addLayers() {
    const map = this.map;
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LAYER_CASING,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': HALO_COLOR, 'line-width': 5, 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], LINE_COLOR], 'line-width': 2.5 },
    });
    map.addLayer({
      id: LAYER_POINT,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['get', 'hl']]],
      paint: {
        'circle-radius': 4,
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
        'circle-radius': 8,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    this.render();
  }

  private render() {
    const src = this.map.getSource<GeoJSONSource>(SOURCE_ID);
    const ab: [LngLat, LngLat] | null = this.line ?? (this.start && this.cursor ? [this.start, this.cursor] : null);
    const features: Feature[] = [];
    let length = 0;
    if (ab) {
      length = segmentLengths(ab)[0] ?? 0;
      const tooLong = length > PROFILE_MAX_LENGTH;
      features.push({
        type: 'Feature',
        properties: tooLong ? { color: '#ff6b6b' } : {},
        geometry: { type: 'LineString', coordinates: ab },
      });
    }
    this.points.forEach((p, i) => {
      features.push({
        type: 'Feature',
        properties: { color: p.color, hl: i === this.highlight },
        geometry: { type: 'Point', coordinates: p.at },
      });
    });
    src?.setData({ type: 'FeatureCollection', features });

    this.clearLabels();
    if (this.start && !ab) this.addLabel(this.start, 'A');
    if (ab) {
      this.addLabel(ab[0], 'A');
      this.addLabel(ab[1], 'B');
      const over = length > PROFILE_MAX_LENGTH ? `（超過 ${PROFILE_MAX_LENGTH} m）` : '';
      this.addLabel(midpoint(ab[0], ab[1]), formatDistance(length) + over, 'bottom');
    }
  }

  private addLabel(at: LngLat, text: string, anchor: maplibregl.PositionAnchor = 'bottom-left') {
    const el = document.createElement('div');
    el.className = LABEL_CLASS;
    el.textContent = text;
    this.labels.push(new maplibregl.Marker({ element: el, anchor, offset: [0, -6] }).setLngLat(at).addTo(this.map));
  }

  private clearLabels() {
    for (const m of this.labels) m.remove();
    this.labels = [];
  }
}
