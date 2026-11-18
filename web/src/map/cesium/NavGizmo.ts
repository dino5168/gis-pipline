// 3D 圖台右上角的立體導覽元件：用一個獨立的小 Cesium 畫面畫出地平面圓盤（方位刻度、N/E/S/W）、
// 天頂軸與地下半球；小畫面的鏡頭方位、俯仰跟主畫面同步，所以模型角度永遠和主畫面一致。
// 只由 CesiumScene.ts 匯入（跟著 Cesium 動態載入，不進主 bundle）。
import {
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  CesiumWidget,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  DirectionalLight,
  EllipsoidGeometry,
  GeometryInstance,
  HeadingPitchRange,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Transforms,
  VerticalOrigin,
} from 'cesium';

/** 點到的部位 */
export type NavGizmoPart = 'north' | 'zenith';

export interface NavGizmoHandle {
  /** 畫面座標（相對小畫面左上角，CSS px）點到的部位 */
  pick(x: number, y: number): NavGizmoPart | null;
  destroy(): void;
}

/** 模型放在台北附近的固定位置（ENU 座標系，單位 m；只是小畫面裡的擺放位置，與實際地點無關） */
const ORIGIN = Cartesian3.fromDegrees(121.5, 25.05, 0);
/** 地平面圓盤半徑 */
const R = 100;
/** 小畫面鏡頭到模型中心的距離 */
const CAMERA_RANGE = 330;
/** 刻度數 */
const TICKS = 12;
/** 地下半球的不透明度（平常／鏡頭在地面下） */
const HEMI_ALPHA = 0.1;
const HEMI_ALPHA_UNDERGROUND = 0.35;

const LABELS: { text: string; bearing: number; color: Color; size: number }[] = [
  { text: 'N', bearing: 0, color: Color.fromCssColorString('#ff4d4f'), size: 16 },
  { text: 'E', bearing: 90, color: Color.WHITE, size: 12 },
  { text: 'S', bearing: 180, color: Color.WHITE, size: 12 },
  { text: 'W', bearing: 270, color: Color.WHITE, size: 12 },
];

/** ENU 平面上方位角（度，北 0、順時針）、半徑對應的位置 */
function enuPoint(bearingDeg: number, radius: number, z = 0): Cartesian3 {
  const b = CesiumMath.toRadians(bearingDeg);
  return new Cartesian3(Math.sin(b) * radius, Math.cos(b) * radius, z);
}

export class NavGizmo implements NavGizmoHandle {
  private readonly widget: CesiumWidget;
  private readonly hemisphere: Primitive;
  private underground = false;

  constructor(container: HTMLElement) {
    const credits = document.createElement('div'); // 不顯示（沒有任何圖資來源）
    this.widget = new CesiumWidget(container, {
      globe: false,
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      creditContainer: credits,
      contextOptions: { webgl: { alpha: true } },
      showRenderLoopErrors: false,
    });
    const { scene } = this.widget;
    scene.backgroundColor = Color.TRANSPARENT;
    scene.fog.enabled = false;
    scene.screenSpaceCameraController.enableInputs = false; // 操作由 Navigation3D 處理

    const enu = Transforms.eastNorthUpToFixedFrame(ORIGIN);
    const at = (local: Matrix4) => Matrix4.multiply(enu, local, new Matrix4());
    // 固定光源：從東南方高處照下（天頂球才有立體感）
    const lightFrom = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(0.4, -0.6, 1), new Cartesian3());
    scene.light = new DirectionalLight({ direction: Cartesian3.negate(Cartesian3.normalize(lightFrom, lightFrom), lightFrom) });

    const color = (c: Color) => ({ color: ColorGeometryInstanceAttribute.fromColor(c) });

    // 地平面圓盤＋刻度（不受光影響，顏色固定）
    const flat: GeometryInstance[] = [
      new GeometryInstance({
        geometry: new CylinderGeometry({ length: 2, topRadius: R, bottomRadius: R, slices: 72 }),
        modelMatrix: enu,
        attributes: color(Color.fromCssColorString('#1e3a4c').withAlpha(0.75)),
      }),
      ...Array.from({ length: TICKS }, (_, i) => {
        const bearing = (i * 360) / TICKS;
        const major = i % (TICKS / 4) === 0;
        const len = major ? 18 : 10;
        return new GeometryInstance({
          geometry: BoxGeometry.fromDimensions({ dimensions: new Cartesian3(major ? 5 : 3, len, 3) }),
          modelMatrix: at(
            Matrix4.fromRotationTranslation(
              Matrix3.fromRotationZ(-CesiumMath.toRadians(bearing)),
              enuPoint(bearing, R - len / 2 - 2, 1.5),
            ),
          ),
          attributes: color(bearing === 0 ? Color.fromCssColorString('#ff4d4f') : Color.WHITE.withAlpha(0.8)),
        });
      }),
    ];
    scene.primitives.add(
      new Primitive({
        geometryInstances: flat,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
        asynchronous: false,
      }),
    );

    // 天頂軸＋頂端球
    const zenithColor = Color.fromCssColorString('#7dd3fc');
    scene.primitives.add(
      new Primitive({
        geometryInstances: [
          new GeometryInstance({
            id: 'zenith',
            geometry: new CylinderGeometry({ length: R, topRadius: 3, bottomRadius: 3 }),
            modelMatrix: at(Matrix4.fromTranslation(new Cartesian3(0, 0, R / 2))),
            attributes: color(zenithColor),
          }),
          new GeometryInstance({
            id: 'zenith',
            geometry: new EllipsoidGeometry({ radii: new Cartesian3(11, 11, 11) }),
            modelMatrix: at(Matrix4.fromTranslation(new Cartesian3(0, 0, R + 6))),
            attributes: color(zenithColor),
          }),
        ],
        appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
        asynchronous: false,
      }),
    );

    // 地下半球（從 +Z 起算 90°～180° 的錐角）
    this.hemisphere = scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({
          id: 'hemisphere',
          geometry: new EllipsoidGeometry({
            radii: new Cartesian3(R, R, R),
            minimumCone: CesiumMath.PI_OVER_TWO,
            maximumCone: Math.PI,
          }),
          modelMatrix: enu,
          attributes: color(Color.fromCssColorString('#a16207').withAlpha(HEMI_ALPHA)),
        }),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
        asynchronous: false,
      }),
    );

    // 方位字（永遠面向鏡頭、不被模型遮住）
    const labels = scene.primitives.add(new LabelCollection());
    for (const l of LABELS) {
      labels.add({
        id: l.text === 'N' ? 'north' : undefined,
        position: Matrix4.multiplyByPoint(enu, enuPoint(l.bearing, R + 16, 2), new Cartesian3()),
        text: l.text,
        font: `700 ${l.size}px sans-serif`,
        fillColor: l.color,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }

  /** 跟主畫面同步：方位、俯仰（弧度，與 Camera.heading/pitch 相同定義）、鏡頭是否在地面下 */
  update(heading: number, pitch: number, underground: boolean) {
    const { scene, camera } = this.widget;
    camera.lookAt(ORIGIN, new HeadingPitchRange(heading, pitch, CAMERA_RANGE));
    if (underground !== this.underground && this.hemisphere.ready) {
      this.underground = underground;
      const attr = this.hemisphere.getGeometryInstanceAttributes('hemisphere');
      attr.color = ColorGeometryInstanceAttribute.toValue(
        Color.fromCssColorString('#a16207').withAlpha(underground ? HEMI_ALPHA_UNDERGROUND : HEMI_ALPHA),
      );
    }
    scene.requestRender();
  }

  pick(x: number, y: number): NavGizmoPart | null {
    const picked: unknown = this.widget.scene.pick(new Cartesian2(x, y));
    const id = picked && typeof picked === 'object' && 'id' in picked ? picked.id : null;
    return id === 'north' || id === 'zenith' ? id : null;
  }

  destroy() {
    if (!this.widget.isDestroyed()) this.widget.destroy();
  }
}
