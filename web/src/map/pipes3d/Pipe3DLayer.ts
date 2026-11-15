// 3D 管線圖層：Three.js 與 MapLibre 共用同一個 WebGL context（MapLibre 自訂圖層）。
// 這個模組只能用動態 import() 載入，避免 Three.js 進主 bundle。
//
// 座標：幾何以「原點附近的公尺」建立（x 東、y 北、z 上），
// 再用 modelMatrix 平移到原點的 Web Mercator 座標並換算單位，避免 float32 精度不足。
import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { MATERIALS, OTHER_MATERIAL } from '../pipeStyle';
import { PIPE3D_MAX_DEPTH } from '../../config';
import type { Pipe3D, Pipe3DOptions } from '../../types/pipe3d';

export const PIPE3D_LAYER_ID = 'pipes-3d';

/** 管徑缺值時的預設（公尺） */
const DEFAULT_DIA = 0.2;
/** 圓柱的圓周分段數 */
const RADIAL_SEGMENTS = 10;

const MATERIAL_COLORS = new Map(MATERIALS.map((m) => [m.code, new THREE.Color(m.color)]));
const OTHER_COLOR = new THREE.Color(OTHER_MATERIAL.color);

const clampDepth = (d: number | null) => Math.min(Math.max(d ?? 0, 0), PIPE3D_MAX_DEPTH);

export class Pipe3DLayer implements maplibregl.CustomLayerInterface {
  readonly id = PIPE3D_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: maplibregl.Map;
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry = new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, false);
  private readonly material = new THREE.MeshLambertMaterial();
  private mesh?: THREE.InstancedMesh;

  private pipes: Pipe3D[] = [];
  private origin = new maplibregl.MercatorCoordinate(0, 0, 0);
  private modelMatrix = new THREE.Matrix4();

  constructor(private options: Pipe3DOptions) {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.4, -0.6, 1); // 東南方高處（本地座標 z 向上）
    this.scene.add(sun);
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.mesh?.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.renderer?.dispose();
    this.map = undefined;
  }

  setData(pipes: Pipe3D[]) {
    this.pipes = pipes;
    this.rebuild();
  }

  setOptions(options: Pipe3DOptions) {
    this.options = options;
    this.rebuild();
  }

  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, args: maplibregl.CustomRenderMethodInput) {
    if (!this.renderer || !this.mesh) return;
    // mainMatrix：Mercator 0..1 座標 → clip space（modelViewProjectionMatrix 是以像素為單位的世界座標，不能用）
    this.camera.projectionMatrix
      .fromArray(args.defaultProjectionData.mainMatrix as ArrayLike<number> as number[])
      .multiply(this.modelMatrix);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  /** 依資料與選項重建所有圓柱（每一段折線一個 instance） */
  private rebuild() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = undefined;
    }
    const segCount = this.pipes.reduce((n, p) => n + Math.max(p.coords.length - 1, 0), 0);
    if (segCount === 0) {
      this.map?.triggerRepaint();
      return;
    }

    // 原點：資料範圍中心
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.pipes) {
      for (const [lng, lat] of p.coords) {
        minX = Math.min(minX, lng); maxX = Math.max(maxX, lng);
        minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
      }
    }
    this.origin = maplibregl.MercatorCoordinate.fromLngLat([(minX + maxX) / 2, (minY + maxY) / 2]);
    const unit = this.origin.meterInMercatorCoordinateUnits(); // 1 公尺 = 多少 Mercator 單位
    this.modelMatrix = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(unit, -unit, unit)); // Mercator y 向南，翻轉成北

    const { heightMode, exaggeration: k } = this.options;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, segCount);
    const up = new THREE.Vector3(0, 1, 0); // CylinderGeometry 的軸向
    const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    let i = 0;

    for (const p of this.pipes) {
      const n = p.coords.length;
      if (n < 2) continue;
      const r = (p.dia && p.dia > 0 ? p.dia : DEFAULT_DIA) / 2;
      const color = (p.mat && MATERIAL_COLORS.get(p.mat)) || OTHER_COLOR;

      // 本地公尺座標（水平）與沿線累積長度
      const xy = p.coords.map(([lng, lat]) => {
        const c = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
        return [(c.x - this.origin.x) / unit, -(c.y - this.origin.y) / unit] as const;
      });
      const acc = [0];
      for (let j = 1; j < n; j++) acc.push(acc[j - 1] + Math.hypot(xy[j][0] - xy[j - 1][0], xy[j][1] - xy[j - 1][1]));
      const total = acc[n - 1] || 1;
      const sd = clampDepth(p.sd), ed = clampDepth(p.ed);

      // 管中心高度（公尺，地表 = 0）
      const centerZ = (j: number) => {
        if (heightMode === 'z') return p.coords[j][2];
        const d = sd + (ed - sd) * (acc[j] / total);
        return heightMode === 'depth-top' ? -(d + r) : -d;
      };

      for (let j = 0; j < n - 1; j++) {
        a.set(xy[j][0], xy[j][1], centerZ(j) * k);
        b.set(xy[j + 1][0], xy[j + 1][1], centerZ(j + 1) * k);
        dir.subVectors(b, a);
        const len = dir.length();
        if (len > 0) q.setFromUnitVectors(up, dir.divideScalar(len));
        else q.identity();
        s.set(r * k, Math.max(len, 1e-3), r * k);
        m.compose(a.clone().add(b).multiplyScalar(0.5), q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color);
        i++;
      }
    }
    mesh.count = i;
    mesh.frustumCulled = false; // 相機矩陣是自訂的，Three 的視錐剔除不適用
    this.mesh = mesh;
    this.scene.add(mesh);
    this.map?.triggerRepaint();
  }
}
