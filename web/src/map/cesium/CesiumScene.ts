// Cesium 3D 圖台：底圖／疊加圖層、半透明地面、3D 管線、與 2D 共用的視角換算。
// 這個模組只能用動態 import() 載入（Cesium 很大，不放進主 bundle）；
// 載入前必須先設定 window.CESIUM_BASE_URL（見 CesiumView.tsx）。
import {
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  DirectionalLight,
  Ellipsoid,
  GeometryInstance,
  HeadingPitchRange,
  ImageryLayer,
  IntersectionTests,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  PerspectiveFrustum,
  Primitive,
  Ray,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
  type ImageryLayerCollection,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { RasterSourceSpecification } from 'maplibre-gl';
import { BASEMAPS, type BasemapId } from '../basemaps';
import { OVERLAYS, OVERLAY_IDS, type OverlayId } from '../overlays';
import { MATERIALS, OTHER_CODE, OTHER_MATERIAL } from '../pipeStyle';
import { metersPerPixel, zoomFromMetersPerPixel } from '../cameraScale';
import { MAP_MAX_PITCH, PIPE3D_MAX_DEPTH, PIPE3D_MAX_SPAN, TAIPEI_CENTER } from '../../config';
import type { CameraView } from '../../types/view';
import type { Bbox } from './loadArea';
import type { Pipe3D, Pipe3DOptions, SectionMode } from '../../types/pipe3d';
import { PIPE_KINDS, type PipeColorMode, type PipeKindId } from '../../types/pipeKind';

/** 管徑缺值時的預設（公尺） */
const DEFAULT_DIA = 0.2;
/** 圓柱的圓周分段數 */
const CYLINDER_SLICES = 10;
/** 共管條數上限（避免異常值產生大量小管） */
const MAX_CONDUITS = 64;

const MAIN_CODES = new Set(MATERIALS.map((m) => m.code));
const MATERIAL_COLORS = new Map(MATERIALS.map((m) => [m.code, Color.fromCssColorString(m.color)]));
const OTHER_COLOR = Color.fromCssColorString(OTHER_MATERIAL.color);
const KIND_COLORS = new Map<PipeKindId, Color>(PIPE_KINDS.map((k) => [k.id, Color.fromCssColorString(k.color)]));

/** 3D 管線的初始狀態 */
export interface PipeSceneInit {
  options: Pipe3DOptions;
  materials: ReadonlySet<string>;
  kinds: ReadonlySet<PipeKindId>;
  colorMode: PipeColorMode;
}

/** 圓柱 instance 的 id（點選時由 scene.pick 取回） */
export interface PipePickId {
  layer: PipeKindId;
  gid: number;
}

const clampDepth = (d: number | null) => Math.min(Math.max(d ?? 0, 0), PIPE3D_MAX_DEPTH);

/** MapLibre 的點陣圖磚來源 → Cesium 圖層（共用同一組 WMTS／XYZ 網址） */
function rasterLayer(src: RasterSourceSpecification, options?: { alpha?: number; show?: boolean }): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: src.tiles![0],
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: src.maxzoom ?? 19,
    credit: src.attribution,
  });
  return new ImageryLayer(provider, options);
}

/**
 * 管段的局部座標：Z 軸沿管線方向（Cylinder／Box 的軸向）、X 軸水平垂直於管線（斷面寬度方向）、
 * Y 軸朝上（斷面高度方向）。垂直的管段改用地軸決定 X 軸。
 */
function segmentFrame(mid: Cartesian3, dir: Cartesian3): Matrix3 {
  const up = Ellipsoid.WGS84.geodeticSurfaceNormal(mid, new Cartesian3());
  let x = Cartesian3.cross(up, dir, new Cartesian3());
  if (Cartesian3.magnitude(x) < 1e-6) x = Cartesian3.cross(Cartesian3.UNIT_Z, dir, x);
  if (Cartesian3.magnitude(x) < 1e-6) x = Cartesian3.clone(Cartesian3.UNIT_X, x);
  Cartesian3.normalize(x, x);
  const y = Cartesian3.cross(dir, x, new Cartesian3());
  return Matrix3.fromColumnMajorArray([x.x, x.y, x.z, y.x, y.y, y.z, dir.x, dir.y, dir.z]);
}

/** 管線斷面（公尺，未放大） */
interface Section {
  /** 外包絡寬、高 */
  w: number;
  h: number;
  /** 外包絡模式畫成圓柱（單條、寬高相近的管） */
  round: boolean;
  /** 小管：條數、格狀排列的欄列數、直徑 */
  count: number;
  cols: number;
  rows: number;
  cd: number;
}

/**
 * 由管徑寬度、高度、共管條數推出斷面。依資料分布推定（見 Progress.md）：
 * - 有高度：寬×高是外包絡，共管條數排成接近外包絡比例的格狀（例：0.12×0.06 兩條 → 2×1）。
 * - 沒有高度：寬度是單條管的直徑，多條時排成接近正方形的格狀。
 */
function sectionOf(p: Pipe3D): Section {
  let w = p.dia && p.dia > 0 ? p.dia : DEFAULT_DIA;
  const count = Math.min(Math.max(Math.round(p.n ?? 1), 1), MAX_CONDUITS);
  // 寬高比超過 10 倍視為高度填錯（例：200mm × 1mm），當作沒有高度
  if (p.h && p.h > 0 && p.h * 10 >= w && w * 10 >= p.h) {
    const h = p.h;
    const cols = Math.min(count, Math.max(1, Math.round(Math.sqrt((count * w) / h))));
    const rows = Math.ceil(count / cols);
    const round = count === 1 && Math.abs(w - h) <= 0.1 * Math.max(w, h);
    return { w, h, round, count, cols, rows, cd: Math.min(w / cols, h / rows) };
  }
  const cd = w;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  w = cols * cd;
  return { w, h: rows * cd, round: count === 1, count, cols, rows, cd };
}

/** 斷面在高度上的一半（埋深量到管頂時，管中心要再往下這麼多） */
function halfHeight(sec: Section, mode: SectionMode): number {
  return mode === 'box' && sec.round ? Math.max(sec.w, sec.h) / 2 : sec.h / 2;
}

export class CesiumScene {
  readonly viewer: Viewer;
  private basemapLayer: ImageryLayer | null = null;
  private readonly overlayLayers = new Map<OverlayId, ImageryLayer>();
  /** 各管線種類一個 Primitive（關閉的種類只隱藏，不重建） */
  private readonly primitives = new Map<PipeKindId, Primitive>();
  /** 需要重建的種類（關閉中的種類等到打開時才建） */
  private readonly dirty = new Set<PipeKindId>();
  /** 被取代、等新版 ready 才移除的 Primitive */
  private readonly stale = new Map<PipeKindId, Primitive[]>();
  /** 各管線種類已載入的資料（關閉的種類保留資料，只是不畫） */
  private readonly pipes = new Map<PipeKindId, Pipe3D[]>();
  private options: Pipe3DOptions;
  private materials: ReadonlySet<string>;
  private kinds: ReadonlySet<PipeKindId>;
  private colorMode: PipeColorMode;

  constructor(container: HTMLElement, init: PipeSceneInit) {
    this.options = init.options;
    this.materials = init.materials;
    this.kinds = init.kinds;
    this.colorMode = init.colorMode;
    this.viewer = new Viewer(container, {
      // 不使用 Cesium ion（底圖改用國土測繪中心圖磚；地形用預設的平滑橢球面）
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      // 只在有變化（鏡頭移動、圖磚載入、呼叫 requestRender）時才重畫，靜止時不佔 GPU
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
    const { scene } = this.viewer;
    scene.globe.baseColor = Color.fromCssColorString('#f6f8fa');
    scene.globe.depthTestAgainstTerrain = true;
    // 允許鏡頭進到地面下
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    // 固定光源（預設是依時間的太陽，夜間時管線會變暗）：從東南方高處照下
    const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(TAIPEI_CENTER[0], TAIPEI_CENTER[1]));
    const lightFrom = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(0.4, -0.6, 1), new Cartesian3());
    scene.light = new DirectionalLight({ direction: Cartesian3.negate(Cartesian3.normalize(lightFrom, lightFrom), lightFrom) });
  }

  destroy() {
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }

  private requestRender() {
    this.viewer.scene.requestRender();
  }

  /** 隱藏時停止繪製迴圈，節省 GPU */
  setVisible(visible: boolean) {
    this.viewer.useDefaultRenderLoop = visible;
    if (visible) this.requestRender();
  }

  /** 左上角顯示 FPS（效能量測用；靜止時不重畫，數字會停在最後一次） */
  setShowFps(show: boolean) {
    this.viewer.scene.debugShowFramesPerSecond = show;
    this.requestRender();
  }

  // ---------------- 圖層

  private get imagery(): ImageryLayerCollection {
    return this.viewer.imageryLayers;
  }

  setBasemap(id: BasemapId) {
    if (this.basemapLayer) this.imagery.remove(this.basemapLayer, true);
    this.basemapLayer = null;
    const src = BASEMAPS[id].source;
    if (!src) return;
    this.basemapLayer = rasterLayer(src);
    this.imagery.add(this.basemapLayer, 0); // 永遠在最下層
    this.requestRender();
  }

  setOverlays(enabled: ReadonlySet<OverlayId>, opacity: number) {
    for (const id of OVERLAY_IDS) {
      let layer = this.overlayLayers.get(id);
      if (!layer && enabled.has(id)) {
        layer = rasterLayer(OVERLAYS[id].source);
        this.imagery.add(layer);
        this.overlayLayers.set(id, layer);
      }
      if (!layer) continue;
      layer.show = enabled.has(id);
      layer.alpha = opacity;
    }
    this.requestRender();
  }

  /** 地面不透明度：小於 1 時地面半透明，才看得到地面下的管線 */
  setGroundOpacity(alpha: number) {
    const t = this.viewer.scene.globe.translucency;
    t.enabled = alpha < 1;
    t.frontFaceAlpha = alpha;
    this.requestRender();
  }

  // ---------------- 視角

  private get fovy(): number {
    const f = this.viewer.camera.frustum;
    return f instanceof PerspectiveFrustum && f.fovy !== undefined ? f.fovy : CesiumMath.toRadians(60);
  }

  /**
   * 套用 2D 的視角：畫面中心的地面解析度與 2D 相同。
   * keepPitch：保留 3D 目前的傾斜角，不採用 v.pitch（傾斜不從 2D 同步過來）
   */
  applyView(v: CameraView, opts?: { keepPitch?: boolean }) {
    const { camera, canvas } = this.viewer.scene;
    const h = canvas.clientHeight || 1;
    const range = (metersPerPixel(v.zoom, v.lat) * h) / (2 * Math.tan(this.fovy / 2));
    const pitch = opts?.keepPitch ? camera.pitch : CesiumMath.toRadians(v.pitch - 90);
    camera.lookAt(
      Cartesian3.fromDegrees(v.lng, v.lat, 0),
      new HeadingPitchRange(CesiumMath.toRadians(v.bearing), pitch, range),
    );
    camera.lookAtTransform(Matrix4.IDENTITY); // 解除鎖定，恢復自由操作
  }

  /** 目前視角換成 2D 的定義；鏡頭在地面下或沒有看向地面時回傳 null */
  getView(): CameraView | null {
    const { camera, canvas, globe } = this.viewer.scene;
    if (camera.positionCartographic.height <= 0) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    const ray = camera.getPickRay(new Cartesian2(w / 2, h / 2));
    if (!ray) return null;
    const hit = IntersectionTests.rayEllipsoid(ray, globe.ellipsoid);
    if (!hit) return null;
    const target = Ray.getPoint(ray, hit.start);
    const c = Cartographic.fromCartesian(target);
    const lat = CesiumMath.toDegrees(c.latitude);
    const dist = Cartesian3.distance(camera.positionWC, target);
    const mpp = (dist * 2 * Math.tan(this.fovy / 2)) / h;
    let bearing = CesiumMath.toDegrees(camera.heading);
    if (bearing > 180) bearing -= 360;
    return {
      lng: CesiumMath.toDegrees(c.longitude),
      lat,
      zoom: zoomFromMetersPerPixel(mpp, lat),
      bearing,
      pitch: Math.min(Math.max(90 + CesiumMath.toDegrees(camera.pitch), 0), MAP_MAX_PITCH),
    };
  }

  /** 每次畫面更新後若鏡頭有變動就通知；回傳取消函式 */
  onViewChange(cb: (v: CameraView) => void): () => void {
    const last = new Matrix4();
    return this.viewer.scene.postRender.addEventListener(() => {
      const m = this.viewer.camera.viewMatrix;
      if (Matrix4.equalsEpsilon(m, last, 1e-9)) return;
      Matrix4.clone(m, last);
      const v = this.getView();
      if (v) cb(v);
    });
  }

  /** 滑鼠移動時回報所指地面的經緯度（指到天空時為 null）；回傳取消函式 */
  onPointerMove(cb: (p: { lng: number; lat: number } | null) => void): () => void {
    const { scene, camera } = this.viewer;
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
      const ray = camera.getPickRay(e.endPosition);
      const pos = (ray && scene.globe.pick(ray, scene)) ?? camera.pickEllipsoid(e.endPosition);
      if (!pos) return cb(null);
      const c = Cartographic.fromCartesian(pos);
      cb({ lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) });
    }, ScreenSpaceEventType.MOUSE_MOVE);
    const leave = () => cb(null);
    scene.canvas.addEventListener('mouseleave', leave);
    return () => {
      scene.canvas.removeEventListener('mouseleave', leave);
      if (!handler.isDestroyed()) handler.destroy();
    };
  }

  // ---------------- 導覽控制（右上角的軸向控制項）

  /** 每次畫面更新後若鏡頭有變動就通知（含鏡頭在地面下）；回傳取消函式 */
  onCameraChange(cb: () => void): () => void {
    const last = new Matrix4();
    return this.viewer.scene.postRender.addEventListener(() => {
      const m = this.viewer.camera.viewMatrix;
      if (Matrix4.equalsEpsilon(m, last, 1e-9)) return;
      Matrix4.clone(m, last);
      cb();
    });
  }

  /**
   * 環繞中心：畫面中心看到的地面點；沒看到地面（看天空、或鏡頭在地面下往下看）時，
   * 取視線上離鏡頭一段距離的點。
   */
  private orbitTarget(): Cartesian3 {
    const { camera, canvas, globe } = this.viewer.scene;
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const ray = camera.getPickRay(new Cartesian2(w / 2, h / 2));
    if (ray) {
      const hit = IntersectionTests.rayEllipsoid(ray, globe.ellipsoid);
      if (hit) return Ray.getPoint(ray, hit.start > 0 ? hit.start : hit.stop);
    }
    const dist = Math.max(Math.abs(camera.positionCartographic.height), 100);
    return Cartesian3.add(
      camera.positionWC,
      Cartesian3.multiplyByScalar(camera.directionWC, dist, new Cartesian3()),
      new Cartesian3(),
    );
  }

  /** 以環繞中心為準，把鏡頭放到指定的方位（弧度）、俯仰（弧度，負值往下看）與距離 */
  private lookAtTarget(target: Cartesian3, heading: number, pitch: number, range: number) {
    const { camera } = this.viewer;
    camera.lookAt(target, new HeadingPitchRange(heading, pitch, range));
    camera.lookAtTransform(Matrix4.IDENTITY); // 解除鎖定，恢復自由操作
    this.viewer.scene.requestRender();
  }

  /**
   * 東(X)、北(Y)、上(Z) 三個軸在畫面上的方向：x 向右、y 向上（單位向量投影，長度 ≤ 1），
   * depth > 0 表示軸指向遠離觀看者。
   */
  axesOnScreen(): Record<'x' | 'y' | 'z', { x: number; y: number; depth: number }> {
    const { camera } = this.viewer;
    const enu = Transforms.eastNorthUpToFixedFrame(this.orbitTarget());
    const axis = (unit: Cartesian3) => {
      const a = Matrix4.multiplyByPointAsVector(enu, unit, new Cartesian3());
      return {
        x: Cartesian3.dot(a, camera.rightWC),
        y: Cartesian3.dot(a, camera.upWC),
        depth: Cartesian3.dot(a, camera.directionWC),
      };
    };
    return { x: axis(Cartesian3.UNIT_X), y: axis(Cartesian3.UNIT_Y), z: axis(Cartesian3.UNIT_Z) };
  }

  /** 繞環繞中心旋轉：dHeading 向右轉、dPitch 往上抬（弧度）。俯仰限制在正上方到正下方之間 */
  orbit(dHeading: number, dPitch: number) {
    const { camera } = this.viewer;
    const target = this.orbitTarget();
    const range = Cartesian3.distance(camera.positionWC, target);
    const limit = CesiumMath.toRadians(89.9);
    const pitch = Math.min(Math.max(camera.pitch + dPitch, -limit), limit);
    this.lookAtTarget(target, camera.heading + dHeading, pitch, range);
  }

  /**
   * 從某個軸向看向環繞中心（距離不變）：
   * +Z 正上方俯視、-Z 正下方仰視；±X 從東／西側、±Y 從北／南側水平看。
   */
  viewFromAxis(axis: 'x' | 'y' | 'z', positive: boolean) {
    const { camera } = this.viewer;
    const target = this.orbitTarget();
    const range = Cartesian3.distance(camera.positionWC, target);
    const right = CesiumMath.PI_OVER_TWO;
    if (axis === 'z') {
      // 俯視／仰視保留目前方位
      this.lookAtTarget(target, camera.heading, positive ? -right + 1e-4 : right - 1e-4, range);
      return;
    }
    // 鏡頭在 +X（東）側要朝西看，方位 270°；以此類推
    const heading = axis === 'x' ? (positive ? 3 * right : right) : positive ? Math.PI : 0;
    this.lookAtTarget(target, heading, 0, range);
  }

  /** 朝環繞中心拉近（factor < 1）或拉遠（factor > 1） */
  zoomBy(factor: number) {
    const { camera } = this.viewer;
    const target = this.orbitTarget();
    const range = Cartesian3.distance(camera.positionWC, target);
    this.lookAtTarget(target, camera.heading, camera.pitch, Math.max(range * factor, 1));
  }

  /** 鏡頭停止移動時通知；回傳取消函式 */
  onMoveEnd(cb: () => void): () => void {
    return this.viewer.camera.moveEnd.addEventListener(cb);
  }

  /** 畫面可見範圍 [west, south, east, north]（度）；取不到時以中心為準取 PIPE3D_MAX_SPAN */
  viewBbox(center: CameraView): Bbox {
    const half = PIPE3D_MAX_SPAN / 2;
    const r = this.viewer.camera.computeViewRectangle();
    if (!r) return [center.lng - half, center.lat - half, center.lng + half, center.lat + half];
    return [r.west, r.south, r.east, r.north].map((x) => CesiumMath.toDegrees(x)) as Bbox;
  }

  // ---------------- 3D 管線

  setPipes(kind: PipeKindId, pipes: Pipe3D[]) {
    this.pipes.set(kind, pipes);
    this.dirty.add(kind);
    this.sync();
  }

  setKinds(kinds: ReadonlySet<PipeKindId>) {
    this.kinds = kinds;
    this.sync();
  }

  setColorMode(mode: PipeColorMode) {
    this.colorMode = mode;
    this.markAllDirty();
  }

  setPipeOptions(options: Pipe3DOptions) {
    this.options = options;
    this.markAllDirty();
  }

  setMaterials(materials: ReadonlySet<string>) {
    this.materials = materials;
    this.markAllDirty();
  }

  private markAllDirty() {
    for (const kind of this.pipes.keys()) this.dirty.add(kind);
    this.sync();
  }

  /** 開啟的種類：需要時重建；關閉的種類：只隱藏 */
  private sync() {
    for (const [kind, prim] of this.primitives) prim.show = this.kinds.has(kind);
    for (const [kind, prims] of this.stale) for (const prim of prims) prim.show = this.kinds.has(kind);
    for (const kind of [...this.dirty]) {
      if (!this.kinds.has(kind)) continue;
      this.dirty.delete(kind);
      this.rebuild(kind);
    }
    this.notifyBusy();
    this.requestRender();
  }

  private readonly busyListeners = new Set<(busy: boolean) => void>();
  private lastBusy = false;

  /** 是否有開啟中的管線種類正在背景建立 3D 模型（新 Primitive 尚未 ready） */
  isBusy(): boolean {
    return [...this.stale.keys()].some((k) => this.kinds.has(k));
  }

  /** 建立 3D 模型的忙碌狀態改變時通知；回傳取消函式 */
  onBusyChange(cb: (busy: boolean) => void): () => void {
    this.busyListeners.add(cb);
    return () => this.busyListeners.delete(cb);
  }

  private notifyBusy() {
    const busy = this.isBusy();
    if (busy === this.lastBusy) return;
    this.lastBusy = busy;
    for (const cb of this.busyListeners) cb(busy);
  }

  private materialShown(mat: string | null): boolean {
    return mat && MAIN_CODES.has(mat) ? this.materials.has(mat) : this.materials.has(OTHER_CODE);
  }

  private pipeColor(kind: PipeKindId, mat: string | null): Color {
    if (this.colorMode === 'kind') return KIND_COLORS.get(kind) ?? OTHER_COLOR;
    return (mat && MATERIAL_COLORS.get(mat)) || OTHER_COLOR;
  }

  /**
   * 依資料、選項、材料篩選重建一種管線的所有管段，合成一個 Primitive。
   * 每一段折線：外包絡模式一個圓柱或方塊；多條小管模式每條小管一個圓柱。
   * 新的 Primitive 在背景（Web Worker）建好之前，舊的繼續顯示，避免閃爍。
   */
  private rebuild(kind: PipeKindId) {
    const instances = this.buildInstances(kind, this.pipes.get(kind) ?? []);
    const next =
      instances.length > 0
        ? new Primitive({
            geometryInstances: instances,
            appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
          })
        : null;
    this.swapPrimitive(kind, next);
  }

  /**
   * 換上新的 Primitive：舊的先留著，等最新的 ready 後才移除（requestRenderMode 下要主動要求重畫來推進建置）。
   * 連續重建時中間版本可能還沒 ready 就被取代，一律收進 stale 等最新的 ready 再一起移除。
   */
  private swapPrimitive(kind: PipeKindId, next: Primitive | null) {
    const { scene } = this.viewer;
    const stale = this.stale.get(kind) ?? [];
    const prev = this.primitives.get(kind);
    if (prev) stale.push(prev);
    const clear = () => {
      for (const old of stale) if (!old.isDestroyed()) scene.primitives.remove(old); // remove 會一併 destroy
      this.stale.delete(kind);
      this.notifyBusy();
      scene.requestRender();
    };
    if (!next) {
      this.primitives.delete(kind);
      clear();
      return;
    }
    this.stale.set(kind, stale);
    this.primitives.set(kind, next);
    next.show = this.kinds.has(kind);
    scene.primitives.add(next);
    this.notifyBusy();
    const tick = () => {
      if (this.viewer.isDestroyed() || this.primitives.get(kind) !== next) return; // 已被更新的版本取代
      if (!next.ready) {
        scene.requestRender();
        requestAnimationFrame(tick);
        return;
      }
      clear();
    };
    tick();
  }

  private buildInstances(kind: PipeKindId, pipes: Pipe3D[]): GeometryInstance[] {
    const { heightMode, section: sectionMode, exaggeration: k } = this.options;
    const instances: GeometryInstance[] = [];

    for (const p of pipes) {
      const n = p.coords.length;
      if (n < 2 || !this.materialShown(p.mat)) continue;
      const sec = sectionOf(p);
      const half = halfHeight(sec, sectionMode);
      const color = ColorGeometryInstanceAttribute.fromColor(this.pipeColor(kind, p.mat));
      const id: PipePickId = { layer: kind, gid: p.gid };

      // 沿線累積水平長度（埋深由起點內插到終點）
      const ground = p.coords.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat, 0));
      const acc = [0];
      for (let j = 1; j < n; j++) acc.push(acc[j - 1] + Cartesian3.distance(ground[j - 1], ground[j]));
      const total = acc[n - 1] || 1;
      const sd = clampDepth(p.sd), ed = clampDepth(p.ed);

      // 管中心高度（公尺，地表 = 0）
      const centerZ = (j: number) => {
        if (heightMode === 'z') return p.coords[j][2];
        const d = sd + (ed - sd) * (acc[j] / total);
        return heightMode === 'depth-top' ? -(d + half) : -d;
      };
      const pos = p.coords.map(([lng, lat], j) => Cartesian3.fromDegrees(lng, lat, centerZ(j) * k));

      for (let j = 0; j < n - 1; j++) {
        const dir = Cartesian3.subtract(pos[j + 1], pos[j], new Cartesian3());
        const len = Cartesian3.magnitude(dir);
        if (len < 1e-3) continue;
        Cartesian3.divideByScalar(dir, len, dir);
        const mid = Cartesian3.midpoint(pos[j], pos[j + 1], new Cartesian3());
        const rot = segmentFrame(mid, dir);
        const add = (geometry: CylinderGeometry | BoxGeometry, center: Cartesian3) =>
          instances.push(
            new GeometryInstance({
              geometry,
              modelMatrix: Matrix4.fromRotationTranslation(rot, center),
              attributes: { color },
              id,
            }),
          );
        const cylinder = (dia: number) =>
          new CylinderGeometry({
            length: len,
            topRadius: (dia / 2) * k,
            bottomRadius: (dia / 2) * k,
            slices: CYLINDER_SLICES,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          });

        if (sectionMode === 'box') {
          if (sec.round) add(cylinder(Math.max(sec.w, sec.h)), mid);
          else
            add(
              BoxGeometry.fromDimensions({
                dimensions: new Cartesian3(sec.w * k, sec.h * k, len),
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              mid,
            );
          continue;
        }
        // 多條小管：在斷面上排成 cols × rows 的格子，由左上開始填
        const cw = sec.w / sec.cols, ch = sec.h / sec.rows;
        for (let i = 0; i < sec.count; i++) {
          const col = i % sec.cols, row = Math.floor(i / sec.cols);
          const local = new Cartesian3((col - (sec.cols - 1) / 2) * cw * k, ((sec.rows - 1) / 2 - row) * ch * k, 0);
          const offset = Matrix3.multiplyByVector(rot, local, local);
          add(cylinder(sec.cd), Cartesian3.add(mid, offset, offset));
        }
      }
    }

    return instances;
  }
}
