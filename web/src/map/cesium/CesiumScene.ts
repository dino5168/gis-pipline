// Cesium 3D 圖台：底圖／疊加圖層、半透明地面、3D 管線、與 2D 共用的視角換算。
// 這個模組只能用動態 import() 載入（Cesium 很大，不放進主 bundle）；
// 載入前必須先設定 window.CESIUM_BASE_URL（見 CesiumView.tsx）。
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  DirectionalLight,
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
  Quaternion,
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
import type { Pipe3D, Pipe3DOptions } from '../../types/pipe3d';

/** 管徑缺值時的預設（公尺） */
const DEFAULT_DIA = 0.2;
/** 圓柱的圓周分段數 */
const CYLINDER_SLICES = 10;

const MAIN_CODES = new Set(MATERIALS.map((m) => m.code));
const MATERIAL_COLORS = new Map(MATERIALS.map((m) => [m.code, Color.fromCssColorString(m.color)]));
const OTHER_COLOR = Color.fromCssColorString(OTHER_MATERIAL.color);

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

/** 把局部 Z 軸（CylinderGeometry 的軸向）轉到 dir 方向的旋轉 */
function rotationZTo(dir: Cartesian3): Matrix3 {
  const axis = Cartesian3.cross(Cartesian3.UNIT_Z, dir, new Cartesian3());
  const s = Cartesian3.magnitude(axis);
  const c = Cartesian3.dot(Cartesian3.UNIT_Z, dir);
  let q: Quaternion;
  if (s < 1e-12) q = c > 0 ? Quaternion.IDENTITY : Quaternion.fromAxisAngle(Cartesian3.UNIT_X, Math.PI);
  else q = Quaternion.fromAxisAngle(Cartesian3.normalize(axis, axis), Math.atan2(s, c));
  return Matrix3.fromQuaternion(q);
}

export class CesiumScene {
  readonly viewer: Viewer;
  private basemapLayer: ImageryLayer | null = null;
  private readonly overlayLayers = new Map<OverlayId, ImageryLayer>();
  private pipesPrimitive: Primitive | null = null;
  private pipes: Pipe3D[] = [];
  private options: Pipe3DOptions;
  private materials: ReadonlySet<string>;

  constructor(container: HTMLElement, init: { options: Pipe3DOptions; materials: ReadonlySet<string> }) {
    this.options = init.options;
    this.materials = init.materials;
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

  /** 隱藏時停止繪製迴圈，節省 GPU */
  setVisible(visible: boolean) {
    this.viewer.useDefaultRenderLoop = visible;
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
  }

  /** 地面不透明度：小於 1 時地面半透明，才看得到地面下的管線 */
  setGroundOpacity(alpha: number) {
    const t = this.viewer.scene.globe.translucency;
    t.enabled = alpha < 1;
    t.frontFaceAlpha = alpha;
  }

  // ---------------- 視角

  private get fovy(): number {
    const f = this.viewer.camera.frustum;
    return f instanceof PerspectiveFrustum && f.fovy !== undefined ? f.fovy : CesiumMath.toRadians(60);
  }

  /** 套用 2D 的視角：畫面中心的地面解析度與 2D 相同 */
  applyView(v: CameraView) {
    const { camera, canvas } = this.viewer.scene;
    const h = canvas.clientHeight || 1;
    const range = (metersPerPixel(v.zoom, v.lat) * h) / (2 * Math.tan(this.fovy / 2));
    camera.lookAt(
      Cartesian3.fromDegrees(v.lng, v.lat, 0),
      new HeadingPitchRange(CesiumMath.toRadians(v.bearing), CesiumMath.toRadians(v.pitch - 90), range),
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

  /** 鏡頭停止移動時通知；回傳取消函式 */
  onMoveEnd(cb: () => void): () => void {
    return this.viewer.camera.moveEnd.addEventListener(cb);
  }

  /** 載入 3D 管線用的範圍：畫面可見範圍，以中心為準限制在 PIPE3D_MAX_SPAN 內 */
  loadBbox(center: CameraView): string {
    const half = PIPE3D_MAX_SPAN / 2 - 1e-6;
    let w = center.lng - half, e = center.lng + half, s = center.lat - half, n = center.lat + half;
    const r = this.viewer.camera.computeViewRectangle();
    if (r) {
      w = Math.max(w, CesiumMath.toDegrees(r.west));
      e = Math.min(e, CesiumMath.toDegrees(r.east));
      s = Math.max(s, CesiumMath.toDegrees(r.south));
      n = Math.min(n, CesiumMath.toDegrees(r.north));
    }
    return [w, s, e, n].map((x) => x.toFixed(6)).join(',');
  }

  // ---------------- 3D 管線

  setPipes(pipes: Pipe3D[]) {
    this.pipes = pipes;
    this.rebuild();
  }

  setPipeOptions(options: Pipe3DOptions) {
    this.options = options;
    this.rebuild();
  }

  setMaterials(materials: ReadonlySet<string>) {
    this.materials = materials;
    this.rebuild();
  }

  private materialShown(mat: string | null): boolean {
    return mat && MAIN_CODES.has(mat) ? this.materials.has(mat) : this.materials.has(OTHER_CODE);
  }

  /** 依資料、選項、材料篩選重建所有圓柱（每一段折線一個 instance，合成一個 Primitive） */
  private rebuild() {
    const primitives = this.viewer.scene.primitives;
    if (this.pipesPrimitive) primitives.remove(this.pipesPrimitive); // remove 會一併 destroy
    this.pipesPrimitive = null;

    const { heightMode, exaggeration: k } = this.options;
    const instances: GeometryInstance[] = [];

    for (const p of this.pipes) {
      const n = p.coords.length;
      if (n < 2 || !this.materialShown(p.mat)) continue;
      const r = (p.dia && p.dia > 0 ? p.dia : DEFAULT_DIA) / 2;
      const color = ColorGeometryInstanceAttribute.fromColor((p.mat && MATERIAL_COLORS.get(p.mat)) || OTHER_COLOR);

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
        return heightMode === 'depth-top' ? -(d + r) : -d;
      };
      const pos = p.coords.map(([lng, lat], j) => Cartesian3.fromDegrees(lng, lat, centerZ(j) * k));

      for (let j = 0; j < n - 1; j++) {
        const dir = Cartesian3.subtract(pos[j + 1], pos[j], new Cartesian3());
        const len = Cartesian3.magnitude(dir);
        if (len < 1e-3) continue;
        Cartesian3.divideByScalar(dir, len, dir);
        const mid = Cartesian3.midpoint(pos[j], pos[j + 1], new Cartesian3());
        instances.push(
          new GeometryInstance({
            geometry: new CylinderGeometry({
              length: len,
              topRadius: r * k,
              bottomRadius: r * k,
              slices: CYLINDER_SLICES,
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            modelMatrix: Matrix4.fromRotationTranslation(rotationZTo(dir), mid),
            attributes: { color },
            id: { gid: p.gid },
          }),
        );
      }
    }

    if (instances.length > 0) {
      this.pipesPrimitive = primitives.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
        }),
      );
    }
    this.viewer.scene.requestRender();
  }
}
