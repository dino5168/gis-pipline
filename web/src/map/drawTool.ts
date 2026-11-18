// 2D 繪圖工具：包裝 Terra Draw（MapLibre adapter）。
// Terra Draw 建立後一直保持啟動（stop() 會清空圖形）；繪圖面板關閉時切回內建的 static 模式，圖形仍留在圖上、不可互動。
import type * as maplibregl from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { lngLatToTwd97 } from './coordTransform';
import { polygonArea, segmentLengths, type LngLat } from './measure';
import {
  DRAW_COLOR,
  DRAW_IMPLEMENTED_MODES,
  DRAW_SHAPE_MODE_NAMES,
  type DrawMeasure,
  type DrawMode,
  type DrawShapeMode,
  type DrawStatus,
} from '../types/draw';

/** Terra Draw 圖層 id 前綴 */
const PREFIX_ID = 'draw';
const STATIC_MODE = 'static';

/** 圖形樣式（第 7 步改成可設定） */
const LINE_WIDTH = 2.5;
const FILL_OPACITY = 0.2;
const VERTEX = {
  coordinatePointColor: DRAW_COLOR,
  coordinatePointWidth: 3,
  coordinatePointOutlineColor: '#ffffff',
  coordinatePointOutlineWidth: 1,
} as const;
const CLOSING_POINT = {
  closingPointColor: '#ffffff',
  closingPointWidth: 4,
  closingPointOutlineColor: DRAW_COLOR,
  closingPointOutlineWidth: 2,
} as const;
const POLYGON = {
  fillColor: DRAW_COLOR,
  fillOpacity: FILL_OPACITY,
  outlineColor: DRAW_COLOR,
  outlineWidth: LINE_WIDTH,
} as const;

/**
 * Esc 由 DrawTool 統一處理（繪製中取消、否則關閉面板），Terra Draw 只保留 Enter 結束。
 * Terra Draw 的按鍵監聽掛在地圖容器上，焦點不在地圖時收不到，所以不交給它取消。
 */
const KEY_EVENTS = { cancel: null, finish: 'Enter' } as const;

function createModes() {
  return [
    new TerraDrawPointMode({
      styles: { pointColor: DRAW_COLOR, pointWidth: 6, pointOutlineColor: '#ffffff', pointOutlineWidth: 2 },
    }),
    new TerraDrawLineStringMode({
      keyEvents: KEY_EVENTS,
      showCoordinatePoints: true,
      styles: { lineStringColor: DRAW_COLOR, lineStringWidth: LINE_WIDTH, ...CLOSING_POINT, ...VERTEX },
    }),
    new TerraDrawPolygonMode({
      keyEvents: KEY_EVENTS,
      showCoordinatePoints: true,
      styles: { ...POLYGON, ...CLOSING_POINT, ...VERTEX },
    }),
    // 矩形：兩次單擊決定對角，邊沿經緯線（與正北平行）
    new TerraDrawRectangleMode({ keyEvents: { cancel: null, finish: null }, styles: POLYGON }),
    // 圓：單擊圓心、再單擊決定半徑
    new TerraDrawCircleMode({ keyEvents: { cancel: null, finish: null }, styles: POLYGON }),
  ];
}

const isShapeMode = (m: unknown): m is DrawShapeMode => typeof m === 'string' && m in DRAW_SHAPE_MODE_NAMES;

/** Terra Draw 的輔助點（頂點、閉合點、吸附點等），不算使用者的圖形 */
function isGuidance(f: GeoJSONStoreFeatures): boolean {
  const p = f.properties;
  return Boolean(
    p.coordinatePoint || p.closingPoint || p.snappingPoint || p.selectionPoint || p.midPoint || p.edited,
  );
}

/** 去掉多邊形外環最後一個重複的起點 */
function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

/** 計算一個圖形的量測值；不支援的圖形回傳 null */
function measureFeature(f: GeoJSONStoreFeatures): DrawMeasure | null {
  const mode = f.properties.mode;
  if (!isShapeMode(mode)) return null;
  const drawing = Boolean(f.properties.currentlyDrawing);
  const g = f.geometry;
  const base = { mode, drawing, lengthM: 0, areaM2: 0 };

  if (g.type === 'Point') return { ...base, lngLat: g.coordinates as LngLat };
  if (g.type === 'LineString') return { ...base, lengthM: sum(segmentLengths(g.coordinates as LngLat[])) };
  if (g.type !== 'Polygon') return null;

  const ring = openRing(g.coordinates[0] as LngLat[]);
  const sides = segmentLengths(ring, true);
  const out: DrawMeasure = { ...base, lengthM: sum(sides), areaM2: polygonArea(ring) };
  if (mode === 'rectangle' && sides.length >= 2) {
    out.widthM = sides[0];
    out.heightM = sides[1];
  } else if (mode === 'circle' && ring.length >= 3) {
    // 圓心取頂點平均，半徑取 TWD97 平均距離
    const xy = ring.map((p) => lngLatToTwd97(p[0], p[1]));
    const cx = sum(xy.map((p) => p[0])) / xy.length;
    const cy = sum(xy.map((p) => p[1])) / xy.length;
    out.radiusM = sum(xy.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) / xy.length;
  }
  return out;
}

interface Options {
  /** 繪圖狀態變化 */
  onChange: (status: DrawStatus) => void;
  /** 使用者按 Esc 要求結束繪圖 */
  onExit: () => void;
}

export class DrawTool {
  private draw: TerraDraw | null = null;
  private mode: DrawMode | null = null;
  private open = false;
  /** 繪製中、或最後畫完的圖形（面板顯示它的量測值） */
  private currentId: string | number | null = null;
  private featureCount = 0;
  private readonly map: maplibregl.Map;
  private readonly opts: Options;

  constructor(map: maplibregl.Map, opts: Options) {
    this.map = map;
    this.opts = opts;
    if (map.isStyleLoaded()) this.init();
    else map.once('load', () => this.init());
  }

  /** 繪圖面板開啟中（其他點選功能，例如管線屬性，應暫停） */
  get active(): boolean {
    return this.open;
  }

  /** 開啟／關閉繪圖；關閉時圖形保留（繪製到一半的會取消） */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) this.attach();
    else {
      this.detach();
      this.mode = null;
      this.currentId = null;
    }
    this.applyMode();
    this.emit();
  }

  /** 切換模式（null＝不在任何模式，只顯示圖形）；繪製到一半的圖形會取消 */
  setMode(mode: DrawMode | null): void {
    this.mode = mode;
    this.currentId = null;
    this.applyMode();
    this.emit();
  }

  destroy(): void {
    if (this.open) this.detach();
    if (this.draw?.enabled) this.draw.stop();
    this.draw = null;
  }

  private init() {
    const adapter = new TerraDrawMapLibreGLAdapter({ map: this.map, prefixId: PREFIX_ID });
    this.draw = new TerraDraw({ adapter, modes: createModes() });
    this.draw.start();
    this.draw.on('change', (ids, type) => this.handleChange(ids, type));
    this.draw.on('finish', (id) => {
      this.currentId = id;
      this.countFeatures();
      this.emit();
    });
    this.applyMode();
    this.countFeatures();
    this.emit();
  }

  /** 把目前模式套到 Terra Draw；未實作的模式維持 static */
  private applyMode() {
    const d = this.draw;
    if (!d?.enabled) return;
    const target = this.open && this.mode && DRAW_IMPLEMENTED_MODES.has(this.mode) ? this.mode : STATIC_MODE;
    if (d.getMode() !== target) d.setMode(target);
  }

  /** 取消繪製到一半的圖形（Terra Draw 切換模式時會清掉） */
  private cancelDrawing() {
    const d = this.draw;
    if (!d?.enabled) return;
    const mode = d.getMode();
    d.setMode(STATIC_MODE);
    d.setMode(mode);
    this.currentId = null;
    this.emit();
  }

  private handleChange(ids: (string | number)[], type: string) {
    const d = this.draw;
    if (!d) return;
    if (type === 'create' || type === 'delete') this.countFeatures();
    if (type === 'create' || type === 'update') {
      // 新出現的繪製中圖形成為目前圖形
      for (const id of ids) {
        const f = d.getSnapshotFeature(id);
        if (f?.properties.currentlyDrawing && !isGuidance(f)) {
          this.currentId = id;
          break;
        }
      }
    }
    if (type === 'styling') return;
    this.emit();
  }

  private countFeatures() {
    const all = this.draw?.getSnapshot() ?? [];
    this.featureCount = all.filter((f) => !isGuidance(f) && !f.properties.currentlyDrawing).length;
  }

  private emit() {
    const d = this.draw;
    const f = d && this.currentId !== null ? d.getSnapshotFeature(this.currentId) : undefined;
    if (!f) this.currentId = null;
    this.opts.onChange({ featureCount: this.featureCount, measure: f ? measureFeature(f) : null });
  }

  // ---- 事件
  private attach() {
    // capture：在 Terra Draw 處理按鍵之前判斷是否繪製中
    window.addEventListener('keydown', this.handleKey, true);
    this.map.doubleClickZoom.disable();
  }

  private detach() {
    window.removeEventListener('keydown', this.handleKey, true);
    this.map.doubleClickZoom.enable();
  }

  private handleKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // 繪製中：取消這個圖形；否則關閉繪圖面板
    if (this.draw?.enabled && this.draw.getModeState() === 'drawing') this.cancelDrawing();
    else this.opts.onExit();
  };
}
