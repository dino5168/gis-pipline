// 3D 量測工具（Cesium）：距離（斜距／水平／高差＋直角三角形輔助線）、點位高度、面積（水平投影，畫在地面）。
// 操作與 2D 相同：單擊加點、雙擊結束、Esc 離開。取點由 CesiumScene.pickMeasurePoint 負責（點到管線取管線表面，否則取地面）。
// 圖形放在專用的 CustomDataSource，每次變化整批重建（點數很少）。
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  HeightReference,
  LabelStyle,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type MaterialProperty,
} from 'cesium';
import type { CesiumScene } from './CesiumScene';
import { formatArea, formatDistance, polygonArea, polygonLabelPoint, segmentLengths, type LngLat } from '../measure';
import { formatDh, formatHeight, segment3D } from '../measure3d';
import { DEFAULT_MEASURE_STYLE, type MeasureStyle } from '../../types/measure';
import type { Measure3DMode, Measure3DResult, MeasurePoint3D } from '../../types/measure3d';

/** 新點與前一點在螢幕上距離小於此值（px）視為同一點（雙擊會先觸發兩次 click） */
const SAME_POINT_PX = 4;
const LABEL_BG = Color.fromCssColorString('#10212d').withAlpha(0.88);
const HELPER_COLOR = Color.WHITE.withAlpha(0.75);
/** Cesium PolylineDash 的 16 位元樣式 */
const DASH_PATTERN = { dashed: 0xff00, dotted: 0xc0c0, 'dash-dot': 0xfe18 } as const;

export interface MeasureTool3DOptions {
  onChange: (result: Measure3DResult | null) => void;
  /** 使用者按 Esc 要求結束量測 */
  onExit: () => void;
}

export class MeasureTool3D {
  private mode: Measure3DMode | null = null;
  private points: MeasurePoint3D[] = [];
  /** 各點點擊時的螢幕位置（判斷雙擊的重複點） */
  private lastClick: Cartesian2 | null = null;
  private cursor: MeasurePoint3D | null = null;
  private drawing = false;
  private style: MeasureStyle = DEFAULT_MEASURE_STYLE;
  private handler: ScreenSpaceEventHandler | null = null;
  private readonly ds = new CustomDataSource('measure3d');
  private readonly offSettings: () => void;

  constructor(
    private readonly scene: CesiumScene,
    private readonly opts: MeasureTool3DOptions,
  ) {
    void scene.viewer.dataSources.add(this.ds);
    // 高度模式改變：高度基準不同，舊結果作廢；放大倍率／地形改變：重畫
    this.offSettings = scene.onHeightSettingsChange((heightModeChanged) => {
      if (heightModeChanged) this.reset();
      this.render();
    });
  }

  get active(): boolean {
    return this.mode !== null;
  }

  /** 切換模式；null＝關閉量測並清除結果。切換模式會清除舊結果 */
  setMode(mode: Measure3DMode | null): void {
    if (mode === this.mode) return;
    const wasActive = this.active;
    this.mode = mode;
    this.reset();
    if (mode && !wasActive) this.attach();
    else if (!mode && wasActive) this.detach();
    this.render();
  }

  setStyle(style: MeasureStyle): void {
    this.style = style;
    this.render();
  }

  destroy(): void {
    this.offSettings();
    window.removeEventListener('keydown', this.handleKey);
    // 卸載時 viewer 可能已先被銷毀
    if (this.scene.viewer.isDestroyed()) return;
    if (this.active) this.detach();
    this.scene.viewer.dataSources.remove(this.ds, true);
  }

  // ---- 事件

  private attach() {
    const canvas = this.scene.viewer.scene.canvas;
    const h = new ScreenSpaceEventHandler(canvas);
    h.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.handleClick(e.position), ScreenSpaceEventType.LEFT_CLICK);
    h.setInputAction(() => this.handleDblClick(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    h.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => this.handleMove(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler = h;
    canvas.addEventListener('mouseleave', this.handleLeave);
    window.addEventListener('keydown', this.handleKey);
    canvas.style.cursor = 'crosshair';
  }

  private detach() {
    const canvas = this.scene.viewer.scene.canvas;
    if (this.handler && !this.handler.isDestroyed()) this.handler.destroy();
    this.handler = null;
    canvas.removeEventListener('mouseleave', this.handleLeave);
    window.removeEventListener('keydown', this.handleKey);
    canvas.style.cursor = '';
  }

  private handleClick(pos: Cartesian2) {
    if (!this.mode) return;
    const p = this.scene.pickMeasurePoint(pos);
    if (!p) return;
    if (this.mode === 'height') {
      // 高度查詢：每次點擊換成新的一點
      this.points = [p];
      this.drawing = false;
      this.render();
      return;
    }
    if (!this.drawing) {
      // 上一次已結束（或剛開始）：清掉舊結果，開始新的量測
      this.reset();
      this.drawing = true;
    }
    if (this.lastClick && Cartesian2.distance(this.lastClick, pos) < SAME_POINT_PX) return;
    this.lastClick = Cartesian2.clone(pos);
    this.points.push(p);
    this.render();
  }

  private handleDblClick() {
    if (!this.drawing) return;
    const min = this.mode === 'area' ? 3 : 2;
    if (this.points.length < min) return;
    this.drawing = false;
    this.cursor = null;
    this.lastClick = null;
    this.render();
  }

  private handleMove(pos: Cartesian2) {
    if (!this.drawing) return;
    // 預覽只取地面（逐一點選管線的 drillPick 太重，不在滑鼠移動時做）
    this.cursor = this.scene.groundPointAt(pos);
    this.render();
  }

  private handleLeave = () => {
    if (!this.cursor) return;
    this.cursor = null;
    this.render();
  };

  private handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.opts.onExit();
  };

  private reset() {
    this.points = [];
    this.cursor = null;
    this.drawing = false;
    this.lastClick = null;
  }

  // ---- 繪製

  private material(color: Color): MaterialProperty {
    const ls = this.style.lineStyle;
    if (ls === 'solid') return new ColorMaterialProperty(color);
    return new PolylineDashMaterialProperty({ color, dashLength: 16, dashPattern: DASH_PATTERN[ls] });
  }

  private label(position: Cartesian3, text: string, opts?: { strong?: boolean; ground?: boolean; above?: boolean }) {
    this.ds.entities.add({
      position,
      label: {
        text,
        font: `${opts?.strong ? 'bold ' : ''}13px "Noto Sans TC", "Microsoft JhengHei", sans-serif`,
        fillColor: Color.WHITE,
        style: LabelStyle.FILL,
        showBackground: true,
        backgroundColor: LABEL_BG,
        backgroundPadding: new Cartesian2(6, 3),
        verticalOrigin: opts?.above ? VerticalOrigin.BOTTOM : VerticalOrigin.CENTER,
        pixelOffset: opts?.above ? new Cartesian2(0, -10) : Cartesian2.ZERO,
        heightReference: opts?.ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  private vertex(position: Cartesian3, color: Color, ground = false) {
    this.ds.entities.add({
      position,
      point: {
        pixelSize: 8,
        color: Color.WHITE,
        outlineColor: color,
        outlineWidth: 2.5,
        heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /** 立體折線（直線、被地面或管線擋住的部分以半透明顯示） */
  private line(positions: Cartesian3[], color: Color, width: number, material?: MaterialProperty) {
    const m = material ?? this.material(color);
    this.ds.entities.add({
      polyline: {
        positions,
        width,
        material: m,
        depthFailMaterial: material ?? this.material(color.withAlpha(0.55)),
        arcType: ArcType.NONE, // 兩點之間畫直線（不沿地表）
      },
    });
  }

  private render() {
    const { entities } = this.ds;
    entities.suspendEvents();
    entities.removeAll();
    if (this.mode === 'distance') this.renderDistance();
    else if (this.mode === 'area') this.renderArea();
    else if (this.mode === 'height') this.renderHeight();
    entities.resumeEvents();
    this.scene.viewer.scene.requestRender();
    this.opts.onChange(this.mode ? this.result() : null);
  }

  /** 加上跟著滑鼠的預覽點 */
  private withCursor(): MeasurePoint3D[] {
    return this.drawing && this.cursor && this.points.length > 0 ? [...this.points, this.cursor] : this.points;
  }

  private renderDistance() {
    const color = Color.fromCssColorString(this.style.color);
    const pts = this.withCursor();
    const pos = pts.map((p) => this.scene.measureScenePosition(p));
    if (pos.length >= 2) this.line(pos, color, this.style.lineWidth);
    const segCount = pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[i + 1];
      const s = segment3D(a, b);
      // 直角三角形輔助線：起點 → 水平到終點正下（上）方 → 垂直到終點
      if (Math.abs(s.dh) >= 0.01) {
        const corner = this.scene.measureScenePosition({ ...b, h: a.h, on: a.on });
        const helper = new PolylineDashMaterialProperty({ color: HELPER_COLOR, dashLength: 8 });
        this.line([pos[i], corner, pos[i + 1]], HELPER_COLOR, 1.5, helper);
        if (segCount === 1) {
          this.label(Cartesian3.midpoint(pos[i], corner, new Cartesian3()), `水平 ${formatDistance(s.horizontal)}`);
          this.label(Cartesian3.midpoint(corner, pos[i + 1], new Cartesian3()), `高差 ${formatDh(s.dh)}`);
        }
      }
      this.label(Cartesian3.midpoint(pos[i], pos[i + 1], new Cartesian3()), formatDistance(s.slant), { strong: true });
    }
    this.points.forEach((_, i) => this.vertex(pos[i], color));
  }

  private renderArea() {
    const color = Color.fromCssColorString(this.style.color);
    const pts = this.withCursor();
    const ll: LngLat[] = pts.map((p) => [p.lng, p.lat]);
    const ground = ll.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat, 0));
    if (ground.length >= 3) {
      this.ds.entities.add({
        polygon: { hierarchy: new PolygonHierarchy(ground), material: color.withAlpha(this.style.fillOpacity) },
      });
    }
    if (ground.length >= 2) {
      const ring = ground.length >= 3 ? [...ground, ground[0]] : ground;
      this.ds.entities.add({
        polyline: { positions: ring, width: this.style.lineWidth, material: this.material(color), clampToGround: true },
      });
      const lens = segmentLengths(ll, ll.length >= 3);
      lens.forEach((len, i) => {
        const a = ground[i], b = ground[(i + 1) % ground.length];
        this.label(Cartesian3.midpoint(a, b, new Cartesian3()), formatDistance(len), { ground: true });
      });
    }
    if (ll.length >= 3) {
      const [lng, lat] = polygonLabelPoint(ll);
      this.label(Cartesian3.fromDegrees(lng, lat, 0), formatArea(polygonArea(ll)), { strong: true, ground: true });
    }
    this.points.forEach((_, i) => this.vertex(ground[i], color, true));
  }

  private renderHeight() {
    const p = this.points[0];
    if (!p) return;
    const color = Color.fromCssColorString(this.style.color);
    const pos = this.scene.measureScenePosition(p);
    const heightMode = this.scene.heightMode;
    // 埋深模式：從點畫一條垂直線到地表（高度 0），看得出埋多深
    if (heightMode !== 'z' && p.h < -0.005) {
      const top = this.scene.measureScenePosition({ ...p, h: 0, on: 'ground' });
      this.line([pos, top], color, this.style.lineWidth);
      this.vertex(top, color);
    }
    this.vertex(pos, color);
    this.label(pos, formatHeight(p.h, heightMode), { strong: true, above: true });
  }

  private result(): Measure3DResult {
    const pts = this.points;
    let slantM = 0, horizontalM = 0;
    for (let i = 1; i < pts.length; i++) {
      const s = segment3D(pts[i - 1], pts[i]);
      slantM += s.slant;
      horizontalM += s.horizontal;
    }
    const ll: LngLat[] = pts.map((p) => [p.lng, p.lat]);
    const isArea = this.mode === 'area';
    return {
      mode: this.mode!,
      heightMode: this.scene.heightMode,
      pointCount: pts.length,
      drawing: this.drawing,
      slantM,
      horizontalM,
      dhM: pts.length >= 2 ? pts[pts.length - 1].h - pts[0].h : 0,
      areaM2: isArea ? polygonArea(ll) : 0,
      perimeterM: isArea ? segmentLengths(ll, ll.length >= 3).reduce((s, v) => s + v, 0) : 0,
      point: this.mode === 'height' ? (pts[0] ?? null) : null,
    };
  }
}
