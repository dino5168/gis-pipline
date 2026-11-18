// 2D 繪圖工具：包裝 Terra Draw（MapLibre adapter）。
// Terra Draw 建立後一直保持啟動（stop() 會清空圖形）；繪圖面板關閉時切回內建的 static 模式，圖形仍留在圖上、不可互動。
// 編輯：選取（拖頂點／加刪頂點）、拖曳用 Terra Draw 的 select 模式（同一個類別開兩個實例，flags 不同）；
// 旋轉、刪除與復原自己寫（Terra Draw 的旋轉只能按住鍵盤、且不進復原紀錄）。
// 吸附：用 Terra Draw 的 snapping.toFeature，只吸附自己畫的圖形（頂點優先、其次是邊），不吸附管線。
// 文字標註：Terra Draw 點模式另開一個實例（modeName 'text'），文字存在 properties.text，
// 用 MapLibre Marker 顯示（地圖樣式沒有 glyphs，不能用 symbol 文字）；選取／拖曳／刪除／復原沿用點的做法。
import type { Feature } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type GeoJSONStoreGeometries,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { lngLatToTwd97, twd97ToLngLat } from './coordTransform';
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

type FeatureId = string | number;

/** Terra Draw 圖層 id 前綴 */
const PREFIX_ID = 'draw';
const STATIC_MODE = 'static';
/** Terra Draw 預設的坐標小數位數（程式改幾何時要四捨五入到這個位數，否則驗證不過） */
const COORD_PRECISION = 9;
/** 復原堆疊上限 */
const MAX_HISTORY = 100;

/** 圖形樣式（第 7 步改成可設定） */
const LINE_WIDTH = 2.5;
const FILL_OPACITY = 0.2;
const SELECTED_COLOR = '#ffffff';
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
/** 選取中：外框／線改白色，頂點控制點用繪圖色 */
const SELECTED = {
  selectedPointColor: SELECTED_COLOR,
  selectedPointWidth: 6,
  selectedPointOutlineColor: DRAW_COLOR,
  selectedPointOutlineWidth: 2,
  selectedLineStringColor: SELECTED_COLOR,
  selectedLineStringWidth: LINE_WIDTH + 0.5,
  selectedPolygonColor: DRAW_COLOR,
  selectedPolygonFillOpacity: FILL_OPACITY + 0.1,
  selectedPolygonOutlineColor: SELECTED_COLOR,
  selectedPolygonOutlineWidth: LINE_WIDTH + 0.5,
  selectionPointColor: DRAW_COLOR,
  selectionPointWidth: 5,
  selectionPointOutlineColor: '#ffffff',
  selectionPointOutlineWidth: 2,
  midPointColor: '#ffffff',
  midPointWidth: 3,
  midPointOutlineColor: DRAW_COLOR,
  midPointOutlineWidth: 1,
} as const;

/**
 * Esc 由 DrawTool 統一處理，Terra Draw 只保留 Enter 結束、Delete 刪除選取的圖形。
 * Terra Draw 的按鍵監聽掛在地圖容器上，焦點不在地圖時收不到，所以不交給它取消。
 */
const KEY_EVENTS = { cancel: null, finish: 'Enter' } as const;
const SELECT_KEY_EVENTS = { deselect: null, delete: 'Delete', rotate: null, scale: null } as const;

const SHAPE_MODES = Object.keys(DRAW_SHAPE_MODE_NAMES) as DrawShapeMode[];

/**
 * 選取類模式的游標：空白處維持 MapLibre 的手形（平移地圖）、圖形上 pointer（可點選）、
 * 頂點／縮放控制點 move（可拖）、拖曳中 grabbing、邊中點 crosshair（加頂點）。
 */
const SELECT_CURSORS = {
  pointerOverFeature: 'pointer',
  pointerOverCoordinate: 'move',
  pointerOverResizeHandle: 'move',
  dragStart: 'grabbing',
  dragEnd: 'pointer',
  insertMidpoint: 'crosshair',
} as const;

/** 吸附距離（螢幕像素；Terra Draw 預設 40px 太黏，繪圖模式改 20px） */
const SNAP_PX = 20;
/** 吸附點樣式：黃色，與繪圖色區分 */
const SNAP_POINT = {
  snappingPointColor: '#facc15',
  snappingPointWidth: 5,
  snappingPointOutlineColor: '#ffffff',
  snappingPointOutlineWidth: 2,
} as const;

/** 可吸附的對象：使用者畫好的圖形（排除輔助點、繪製中的圖形；正在畫／編輯的圖形本身由 Terra Draw 排除） */
function snapTarget(f: Feature): boolean {
  const p = f.properties;
  if (!p || !SHAPE_MODES.includes(p.mode) || p.mode === TEXT_MODE) return false;
  return !(p.currentlyDrawing || p.coordinatePoint || p.closingPoint || p.snappingPoint || p.selectionPoint || p.midPoint);
}

/** 吸附到其他圖形的頂點與邊（頂點優先） */
const SNAP_TO_FEATURE = { toFeature: { filter: snapTarget, toCoordinate: true, toLine: true }, showSnappingPoint: true };

/** 文字標註 */
const TEXT_MODE = 'text';
const TEXT_MAX_LENGTH = 100;
/** 文字顏色同繪圖色，深色描邊讓文字在各種底圖上都看得清楚 */
const TEXT_SHADOW = '0 0 2px #000, 0 0 3px #000, 0 0 4px #000';
/** 文字標籤可以點的模式：選取／拖曳＝選取、刪除＝刪除、文字＝修改文字（其他模式不擋地圖操作） */
const TEXT_CLICK_MODES: ReadonlySet<DrawMode> = new Set<DrawMode>(['select', 'drag', 'delete', 'text']);

/** 編輯中的文字標註 */
interface TextEdit {
  id: FeatureId;
  /** 剛放下的新標註（取消或空白就刪除） */
  isNew: boolean;
  marker: maplibregl.Marker;
}

/** 每種圖形套用同一組 select flags */
function flagsForAll(feature: object) {
  return Object.fromEntries(SHAPE_MODES.map((m) => [m, { feature }]));
}

/** 選取／編輯頂點：線、多邊形拖頂點、點邊中點加頂點、右鍵刪頂點；矩形拖角縮放；圓拖邊改半徑；點直接拖 */
const EDIT_FLAGS = {
  ...flagsForAll({}),
  point: { feature: { draggable: true } },
  text: { feature: { draggable: true } },
  linestring: { feature: { coordinates: { draggable: true, midpoints: true, deletable: true, snappable: SNAP_TO_FEATURE } } },
  polygon: { feature: { coordinates: { draggable: true, midpoints: true, deletable: true, snappable: SNAP_TO_FEATURE } } },
  rectangle: { feature: { coordinates: { resizable: 'opposite' } } },
  circle: { feature: { coordinates: { resizable: 'center' } } },
};

function createModes() {
  const select = (modeName: string, flags: Record<string, object>) =>
    new TerraDrawSelectMode({
      modeName,
      flags,
      keyEvents: SELECT_KEY_EVENTS,
      cursors: SELECT_CURSORS,
      styles: { ...SELECTED, ...SNAP_POINT },
    });
  return [
    new TerraDrawPointMode({
      pointerDistance: SNAP_PX,
      snapping: SNAP_TO_FEATURE,
      styles: { pointColor: DRAW_COLOR, pointWidth: 6, pointOutlineColor: '#ffffff', pointOutlineWidth: 2, ...SNAP_POINT },
    }),
    new TerraDrawLineStringMode({
      keyEvents: KEY_EVENTS,
      showCoordinatePoints: true,
      pointerDistance: SNAP_PX,
      snapping: SNAP_TO_FEATURE,
      styles: { lineStringColor: DRAW_COLOR, lineStringWidth: LINE_WIDTH, ...CLOSING_POINT, ...VERTEX, ...SNAP_POINT },
    }),
    new TerraDrawPolygonMode({
      keyEvents: KEY_EVENTS,
      showCoordinatePoints: true,
      pointerDistance: SNAP_PX,
      snapping: SNAP_TO_FEATURE,
      styles: { ...POLYGON, ...CLOSING_POINT, ...VERTEX, ...SNAP_POINT },
    }),
    // 矩形：兩次單擊決定對角，邊沿經緯線（與正北平行）；Terra Draw 矩形不支援吸附
    new TerraDrawRectangleMode({ keyEvents: { cancel: null, finish: null }, styles: POLYGON }),
    // 圓：單擊圓心、再單擊決定半徑；只有圓心可吸附
    new TerraDrawCircleMode({
      keyEvents: { cancel: null, finish: null },
      pointerDistance: SNAP_PX,
      snapping: SNAP_TO_FEATURE,
      styles: { ...POLYGON, ...SNAP_POINT },
    }),
    // 文字標註：單擊放置位置（小點），再輸入文字；不吸附
    new TerraDrawPointMode({
      modeName: TEXT_MODE,
      styles: { pointColor: DRAW_COLOR, pointWidth: 3, pointOutlineColor: '#ffffff', pointOutlineWidth: 1 },
    }),
    select('select', EDIT_FLAGS),
    select('drag', flagsForAll({ draggable: true })),
    // 旋轉：只負責選取與醒目顯示，拖曳旋轉由 DrawTool 處理
    select('rotate', flagsForAll({})),
  ];
}

/** 我們的模式 → Terra Draw 模式（刪除模式不需要 Terra Draw 互動，用 static） */
const terraMode = (m: DrawMode): string => (m === 'delete' ? STATIC_MODE : m);

const isShapeMode = (m: unknown): m is DrawShapeMode => typeof m === 'string' && m in DRAW_SHAPE_MODE_NAMES;

/** Terra Draw 的輔助點（頂點、閉合點、吸附點等），不算使用者的圖形 */
function isGuidance(f: GeoJSONStoreFeatures): boolean {
  const p = f.properties;
  return Boolean(
    p.coordinatePoint || p.closingPoint || p.snappingPoint || p.selectionPoint || p.midPoint || p.edited,
  );
}

/** 使用者畫好的圖形（不含輔助點、繪製中的圖形） */
const isUserFeature = (f: GeoJSONStoreFeatures) => !isGuidance(f) && !f.properties.currentlyDrawing;

/** 復原快照不保存的屬性（選取狀態、輔助點 id 等，還原時由 Terra Draw 重建） */
const TRANSIENT_PROPS = [
  'selected',
  'edited',
  'currentlyDrawing',
  'coordinatePointIds',
  'provisionalCoordinateCount',
  'committedCoordinateCount',
];

function snapshotFeature(f: GeoJSONStoreFeatures): GeoJSONStoreFeatures {
  const properties = { ...f.properties };
  for (const k of TRANSIENT_PROPS) delete properties[k];
  return { ...f, properties };
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

const round = (v: number) => Number(v.toFixed(COORD_PRECISION));

/** 旋轉中的圖形：原始坐標（TWD97）、旋轉中心、起始角度 */
interface RotateState {
  id: FeatureId;
  type: 'LineString' | 'Polygon';
  /** LineString 為一條、Polygon 為各環 */
  rings: [number, number][][];
  center: [number, number];
  startAngle: number;
}

interface Options {
  /** 繪圖狀態變化 */
  onChange: (status: DrawStatus) => void;
  /** DrawTool 要求切換模式（例如 Esc 回到選取），由 React 狀態帶動 setMode */
  onModeRequest: (mode: DrawMode) => void;
  /** 使用者按 Esc 要求結束繪圖 */
  onExit: () => void;
}

export class DrawTool {
  private draw: TerraDraw | null = null;
  private mode: DrawMode | null = null;
  private open = false;
  /** 繪製中、選取中，或最後畫完的圖形（面板顯示它的量測值） */
  private currentId: FeatureId | null = null;
  private selectedId: FeatureId | null = null;
  private featureCount = 0;
  /** 復原：已確定狀態的快照（JSON），最後一筆是目前狀態 */
  private history: string[] = [];
  private redoStack: string[] = [];
  /** 還原快照中（期間的 change 事件不記錄） */
  private restoring = false;
  /** 滑鼠按住中（拖曳頂點／圖形時不記錄中間狀態） */
  private pointerDown = false;
  private rotating: RotateState | null = null;
  /** 文字標註的 Marker（feature id → Marker） */
  private textLabels = new Map<FeatureId, maplibregl.Marker>();
  private textEdit: TextEdit | null = null;
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
    this.endTextEdit(true);
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

  /** 切換模式（null＝不在任何模式，只顯示圖形）；繪製到一半的圖形會取消、選取會取消 */
  setMode(mode: DrawMode | null): void {
    this.endTextEdit(true);
    this.mode = mode;
    this.currentId = null;
    this.applyMode();
    this.emit();
  }

  /** 復原上一個動作（繪製中則取消這個圖形） */
  undo(): void {
    if (this.textEdit) {
      this.endTextEdit(false);
      return;
    }
    if (this.isDrawing()) {
      this.cancelDrawing();
      return;
    }
    if (this.history.length < 2) return;
    this.redoStack.push(this.history.pop()!);
    this.restore(this.history[this.history.length - 1]);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.endTextEdit(false);
    if (this.isDrawing()) this.cancelDrawing();
    this.history.push(next);
    this.restore(next);
  }

  destroy(): void {
    this.endTextEdit(false);
    for (const m of this.textLabels.values()) m.remove();
    this.textLabels.clear();
    if (this.open) this.detach();
    if (this.draw?.enabled) this.draw.stop();
    this.draw = null;
  }

  private init() {
    const adapter = new TerraDrawMapLibreGLAdapter({ map: this.map, prefixId: PREFIX_ID });
    this.draw = new TerraDraw({ adapter, modes: createModes() });
    this.draw.start();
    this.draw.on('change', (ids, type) => this.handleChange(ids, type));
    this.draw.on('finish', (id, ctx) => {
      this.currentId = id;
      this.countFeatures();
      // 新的文字標註：先輸入文字，確定後才記入復原
      if (ctx.mode === TEXT_MODE && ctx.action === 'draw') this.startTextEdit(id, true);
      else this.checkpoint();
      this.emit();
    });
    this.draw.on('select', (id) => {
      this.selectedId = id;
      this.currentId = id;
      this.syncTextLabels();
      this.emit();
    });
    this.draw.on('deselect', (id) => {
      if (this.selectedId === id) this.selectedId = null;
      if (this.currentId === id) this.currentId = null;
      this.syncTextLabels();
      this.emit();
    });
    this.history = [this.serialize()];
    this.applyMode();
    this.countFeatures();
    this.emit();
  }

  /** 把目前模式套到 Terra Draw；未實作的模式維持 static */
  private applyMode() {
    const d = this.draw;
    if (!d?.enabled) return;
    const target =
      this.open && this.mode && DRAW_IMPLEMENTED_MODES.has(this.mode) ? terraMode(this.mode) : STATIC_MODE;
    if (d.getMode() !== target) d.setMode(target);
    this.selectedId = null;
    this.updateCursor();
    this.syncTextLabels();
  }

  private updateCursor() {
    this.map.getCanvas().style.cursor = this.open && this.mode === 'delete' ? 'not-allowed' : '';
  }

  private isDrawing(): boolean {
    return Boolean(this.draw?.enabled && this.draw.getModeState() === 'drawing');
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

  private deselect() {
    const d = this.draw;
    if (d?.enabled && this.selectedId !== null && d.hasFeature(this.selectedId)) d.deselectFeature(this.selectedId);
    this.selectedId = null;
  }

  private handleChange(ids: FeatureId[], type: string) {
    const d = this.draw;
    if (!d || type === 'styling') return;
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
    // 編輯（右鍵刪頂點、Delete 刪圖形等）不一定有 finish 事件，改在狀態穩定時比對快照
    if (!this.restoring && !this.pointerDown && !this.rotating && !this.isDrawing()) {
      queueMicrotask(() => this.checkpoint());
    }
    this.syncTextLabels();
    this.emit();
  }

  private countFeatures() {
    const all = this.draw?.getSnapshot() ?? [];
    this.featureCount = all.filter(isUserFeature).length;
  }

  // ---- 復原
  private serialize(): string {
    const all = this.draw?.getSnapshot() ?? [];
    return JSON.stringify(all.filter(isUserFeature).map(snapshotFeature));
  }

  /** 狀態與上一個快照不同時記一筆 */
  private checkpoint() {
    if (!this.draw?.enabled || this.restoring || this.textEdit || this.isDrawing()) return;
    const s = this.serialize();
    if (s === this.history[this.history.length - 1]) return;
    this.history.push(s);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.redoStack = [];
    this.emit();
  }

  private restore(json: string) {
    const d = this.draw;
    if (!d?.enabled) return;
    this.restoring = true;
    try {
      this.deselect();
      const ids = d.getSnapshot().filter(isUserFeature).map((f) => f.id as FeatureId);
      if (ids.length) d.removeFeatures(ids);
      const features = JSON.parse(json) as GeoJSONStoreFeatures[];
      if (features.length) {
        const bad = d.addFeatures(features).filter((v) => !v.valid);
        if (bad.length) console.warn('[draw] 復原時有圖形無法還原', bad);
      }
    } finally {
      this.restoring = false;
    }
    this.currentId = null;
    this.countFeatures();
    this.syncTextLabels();
    this.emit();
  }

  // ---- 文字標註
  /** 依 Terra Draw 的文字點建立／更新／移除 Marker */
  private syncTextLabels() {
    const d = this.draw;
    if (!d?.enabled) return;
    const clickable = this.open && this.mode !== null && TEXT_CLICK_MODES.has(this.mode);
    const seen = new Set<FeatureId>();
    for (const f of d.getSnapshot()) {
      if (f.properties.mode !== TEXT_MODE || f.geometry.type !== 'Point' || !isUserFeature(f)) continue;
      const id = f.id as FeatureId;
      // 編輯中的標註由輸入框取代
      if (this.textEdit?.id === id) continue;
      seen.add(id);
      const at = f.geometry.coordinates as LngLat;
      let marker = this.textLabels.get(id);
      if (!marker) {
        marker = new maplibregl.Marker({ element: this.createTextLabel(id), anchor: 'bottom', offset: [0, -4] })
          .setLngLat(at)
          .addTo(this.map);
        this.textLabels.set(id, marker);
      } else marker.setLngLat(at);
      const el = marker.getElement();
      const text = typeof f.properties.text === 'string' ? f.properties.text : '';
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('pointer-events-none', !clickable);
      el.classList.toggle('cursor-pointer', clickable);
      el.classList.toggle('ring-1', this.selectedId === id);
      el.title = clickable ? this.textLabelTitle() : '';
    }
    for (const [id, m] of this.textLabels) {
      if (seen.has(id)) continue;
      m.remove();
      this.textLabels.delete(id);
    }
  }

  private textLabelTitle(): string {
    if (this.mode === 'delete') return '單擊刪除';
    if (this.mode === 'text') return '單擊修改文字';
    return '單擊選取；雙擊修改文字';
  }

  private createTextLabel(id: FeatureId): HTMLElement {
    const el = document.createElement('div');
    el.className = 'rounded px-1 text-sm leading-tight font-semibold whitespace-pre select-none ring-white/80';
    el.style.color = DRAW_COLOR;
    el.style.textShadow = TEXT_SHADOW;
    // 標籤不在 canvas 上，Terra Draw 收不到，點選自己處理；不讓事件帶動地圖（拖曳、雙擊放大）
    for (const type of ['mousedown', 'pointerdown', 'dblclick'] as const)
      el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleTextLabelClick(id);
    });
    el.addEventListener('dblclick', () => {
      if (this.mode === 'select' || this.mode === 'drag') this.startTextEdit(id, false);
    });
    return el;
  }

  private handleTextLabelClick(id: FeatureId) {
    const d = this.draw;
    if (!d?.enabled || !d.hasFeature(id) || !this.mode) return;
    if (this.mode === 'delete') {
      d.removeFeatures([id]);
      this.countFeatures();
      this.checkpoint();
      this.emit();
    } else if (this.mode === 'text') this.startTextEdit(id, false);
    else if ((this.mode === 'select' || this.mode === 'drag') && this.selectedId !== id) d.selectFeature(id, this.mode);
  }

  /** 在標註位置顯示輸入框；Enter 或點到別處確定、Esc 取消 */
  private startTextEdit(id: FeatureId, isNew: boolean) {
    const d = this.draw;
    if (!d?.enabled) return;
    this.endTextEdit(true);
    const f = d.getSnapshotFeature(id);
    if (!f || f.geometry.type !== 'Point') return;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = TEXT_MAX_LENGTH;
    input.placeholder = '輸入文字，Enter 確定';
    input.value = typeof f.properties.text === 'string' ? f.properties.text : '';
    input.className =
      'bg-card/95 text-foreground placeholder:text-muted-foreground ring-primary w-48 rounded px-1.5 py-0.5 text-sm shadow-sm ring-1 outline-none';
    for (const type of ['mousedown', 'pointerdown', 'pointerup', 'click', 'dblclick', 'wheel'] as const)
      input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.endTextEdit(true);
      else if (e.key === 'Escape') this.endTextEdit(false);
    });
    input.addEventListener('blur', () => this.endTextEdit(true));
    const marker = new maplibregl.Marker({ element: input, anchor: 'bottom', offset: [0, -4] })
      .setLngLat(f.geometry.coordinates as LngLat)
      .addTo(this.map);
    this.textEdit = { id, isNew, marker };
    this.textLabels.get(id)?.remove();
    this.textLabels.delete(id);
    this.emit();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  /** 結束文字編輯：commit＝套用輸入的文字（空白則刪除標註）；否則取消（新標註刪除、舊標註維持原文字） */
  private endTextEdit(commit: boolean) {
    const edit = this.textEdit;
    if (!edit) return;
    this.textEdit = null;
    const text = (edit.marker.getElement() as HTMLInputElement).value.trim();
    edit.marker.remove();
    const d = this.draw;
    if (d?.enabled && d.hasFeature(edit.id)) {
      if (commit && text) d.updateFeatureProperties(edit.id, { text });
      else if (commit || edit.isNew) d.removeFeatures([edit.id]);
    }
    this.countFeatures();
    this.syncTextLabels();
    this.checkpoint();
    this.emit();
  }

  private emit() {
    const d = this.draw;
    let f = d && this.currentId !== null ? d.getSnapshotFeature(this.currentId) : undefined;
    if (!f) {
      this.currentId = null;
      f = undefined;
    }
    this.opts.onChange({
      featureCount: this.featureCount,
      measure: f ? measureFeature(f) : null,
      selected: this.selectedId !== null,
      canUndo: this.history.length > 1 || this.isDrawing() || this.textEdit !== null,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ---- 刪除、旋轉（自己處理滑鼠）
  /** 滑鼠位置上最上層的使用者圖形 */
  private featureAt(e: maplibregl.MapMouseEvent): GeoJSONStoreFeatures | undefined {
    const d = this.draw;
    if (!d?.enabled) return undefined;
    const hits = d.getFeaturesAtPointerEvent(e.originalEvent, {
      ignoreCoordinatePoints: true,
      ignoreClosingPoints: true,
      ignoreSnappingPoints: true,
      ignoreCurrentlyDrawing: true,
    });
    // 先點、再線、最後面：小的圖形優先
    const order = { Point: 0, LineString: 1, Polygon: 2 } as const;
    return hits.filter(isUserFeature).sort((a, b) => order[a.geometry.type] - order[b.geometry.type])[0];
  }

  private handleClick = (e: maplibregl.MapMouseEvent) => {
    if (this.mode !== 'delete' || !this.draw?.enabled) return;
    const f = this.featureAt(e);
    if (!f) return;
    this.draw.removeFeatures([f.id as FeatureId]);
    this.countFeatures();
    this.checkpoint();
    this.emit();
  };

  private handleMouseDown = (e: maplibregl.MapMouseEvent) => {
    if (this.mode !== 'rotate' || e.originalEvent.button !== 0 || !this.draw?.enabled) return;
    const f = this.featureAt(e);
    if (!f || f.geometry.type === 'Point') return;
    // 不讓地圖跟著拖
    e.preventDefault();
    const id = f.id as FeatureId;
    if (this.selectedId !== id) this.draw.selectFeature(id, 'rotate');
    const rings = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).map((r) =>
      r.map((p) => lngLatToTwd97(p[0], p[1])),
    );
    // 旋轉中心：外環（或線）頂點平均
    const outer = f.geometry.type === 'Polygon' ? openRing(rings[0] as LngLat[]) : rings[0];
    const center: [number, number] = [
      sum(outer.map((p) => p[0])) / outer.length,
      sum(outer.map((p) => p[1])) / outer.length,
    ];
    this.rotating = { id, type: f.geometry.type, rings, center, startAngle: this.screenAngle(center, e.point) };
    this.map.getCanvas().style.cursor = 'grabbing';
    window.addEventListener('mouseup', this.handleRotateEnd);
  };

  /** 滑鼠相對旋轉中心的螢幕角度（弧度，y 向下＝順時針為正） */
  private screenAngle(center: [number, number], point: maplibregl.Point): number {
    const c = this.map.project(twd97ToLngLat(center[0], center[1]));
    return Math.atan2(point.y - c.y, point.x - c.x);
  }

  private handleMouseMove = (e: maplibregl.MapMouseEvent) => {
    const r = this.rotating;
    const d = this.draw;
    if (!r || !d?.enabled) return;
    // 螢幕順時針 = TWD97（y 向北）順時針 = 數學角度取負
    const t = -(this.screenAngle(r.center, e.point) - r.startAngle);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const [cx, cy] = r.center;
    const rings = r.rings.map((ring) =>
      ring.map(([x, y]) => {
        const p = twd97ToLngLat(cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos);
        return [round(p[0]), round(p[1])];
      }),
    );
    // 多邊形的環要首尾相同（四捨五入後再設一次）
    if (r.type === 'Polygon') for (const ring of rings) ring[ring.length - 1] = [...ring[0]];
    const geometry: GeoJSONStoreGeometries =
      r.type === 'Polygon' ? { type: 'Polygon', coordinates: rings } : { type: 'LineString', coordinates: rings[0] };
    try {
      d.updateFeatureGeometry(r.id, geometry);
    } catch (err) {
      console.warn('[draw] 旋轉失敗', err);
    }
  };

  private handleRotateEnd = () => {
    window.removeEventListener('mouseup', this.handleRotateEnd);
    if (!this.rotating) return;
    this.rotating = null;
    this.updateCursor();
    this.checkpoint();
    this.emit();
  };

  // ---- 事件
  private attach() {
    // capture：在 Terra Draw 處理按鍵之前判斷是否繪製中
    window.addEventListener('keydown', this.handleKey, true);
    window.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('pointerup', this.handlePointerUp, true);
    this.map.on('click', this.handleClick);
    this.map.on('mousedown', this.handleMouseDown);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.doubleClickZoom.disable();
  }

  private detach() {
    window.removeEventListener('keydown', this.handleKey, true);
    window.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('pointerup', this.handlePointerUp, true);
    this.map.off('click', this.handleClick);
    this.map.off('mousedown', this.handleMouseDown);
    this.map.off('mousemove', this.handleMouseMove);
    this.handleRotateEnd();
    this.pointerDown = false;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
  }

  private handlePointerDown = () => {
    this.pointerDown = true;
  };

  private handlePointerUp = () => {
    this.pointerDown = false;
    // 等 Terra Draw 處理完放開滑鼠（拖曳結束）再比對
    setTimeout(() => this.checkpoint(), 0);
  };

  private handleKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (e.key !== 'Escape') return;
    // Esc 依序：取消繪製中的圖形 → 取消選取 → 回到「選取」模式 → 關閉繪圖面板
    if (this.isDrawing()) this.cancelDrawing();
    else if (this.selectedId !== null) {
      this.deselect();
      this.currentId = null;
      this.emit();
    } else if (this.mode !== null && this.mode !== 'select') this.opts.onModeRequest('select');
    else this.opts.onExit();
  };
}
