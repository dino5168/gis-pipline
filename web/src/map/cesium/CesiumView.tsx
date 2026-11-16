// 3D 圖台（Cesium）：第一次需要時才動態載入 Cesium，之後保持存在（隱藏時停止繪製）。
import { useEffect, useRef, useState } from 'react';
import { CESIUM_BASE_URL, PIPE3D_LIMIT, PIPE3D_MIN_ZOOM } from '../../config';
import type { BasemapId } from '../basemaps';
import type { OverlayId } from '../overlays';
import type { Pipe3DOptions, Pipe3DStatus, Pipes3DResponse } from '../../types/pipe3d';
import type { CesiumScene } from './CesiumScene';
import { ScaleBar } from '../../components/ScaleBar';
import { metersPerPixel } from '../cameraScale';
import { setPointerLngLat } from '../pointerCoord';
import type { ScaleBarSettings } from '../../types/scaleBar';

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

interface Props {
  visible: boolean;
  basemap: BasemapId;
  overlays: ReadonlySet<OverlayId>;
  overlayOpacity: number;
  enabledMaterials: ReadonlySet<string>;
  pipe3dOptions: Pipe3DOptions;
  /** 地面不透明度 0～1 */
  groundOpacity: number;
  scaleBar: ScaleBarSettings;
  onStatus: (s: Pipe3DStatus) => void;
  /** 場景建立完成（或卸載時傳 null），供上層做視角同步 */
  onReady: (scene: CesiumScene | null) => void;
}

export function CesiumView(p: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CesiumScene | null>(null);
  const [mpp, setMpp] = useState<number | null>(null);

  // 最新的 props（建立場景時套用初始狀態用，避免重建）
  const latest = useRef(p);
  latest.current = p;

  // ---- 建立場景（只執行一次）
  useEffect(() => {
    let cancelled = false;
    let created: CesiumScene | null = null;
    window.CESIUM_BASE_URL = CESIUM_BASE_URL;
    latest.current.onStatus({ kind: 'loading' });
    import('./CesiumScene')
      .then(({ CesiumScene }) => {
        if (cancelled || !containerRef.current) return;
        const cur = latest.current;
        created = new CesiumScene(containerRef.current, {
          options: cur.pipe3dOptions,
          materials: cur.enabledMaterials,
        });
        setScene(created);
        cur.onStatus({ kind: 'off' });
        cur.onReady(created);
      })
      .catch((err: Error) => latest.current.onStatus({ kind: 'error', message: `無法載入 Cesium：${err.message}` }));
    return () => {
      cancelled = true;
      if (created) {
        latest.current.onReady(null);
        created.destroy();
      }
    };
  }, []);

  // ---- 顯示／隱藏
  useEffect(() => scene?.setVisible(p.visible), [scene, p.visible]);

  // ---- 圖層
  useEffect(() => scene?.setBasemap(p.basemap), [scene, p.basemap]);
  useEffect(() => scene?.setOverlays(p.overlays, p.overlayOpacity), [scene, p.overlays, p.overlayOpacity]);
  useEffect(() => scene?.setGroundOpacity(p.groundOpacity), [scene, p.groundOpacity]);

  // ---- 管線選項、材料篩選
  useEffect(() => scene?.setPipeOptions(p.pipe3dOptions), [scene, p.pipe3dOptions]);
  useEffect(() => scene?.setMaterials(p.enabledMaterials), [scene, p.enabledMaterials]);

  // ---- 比例尺：畫面中心的地面解析度（鏡頭傾斜時只代表畫面中心附近）
  useEffect(() => {
    if (!scene) return;
    const update = () => {
      const v = scene.getView();
      setMpp(v ? metersPerPixel(v.zoom, v.lat) : null);
    };
    update();
    return scene.onViewChange((v) => setMpp(metersPerPixel(v.zoom, v.lat)));
  }, [scene]);

  // ---- 坐標顯示：滑鼠所指地面位置
  useEffect(() => scene?.onPointerMove(setPointerLngLat), [scene]);

  // ---- 鏡頭停止時依畫面範圍載入管線
  useEffect(() => {
    if (!scene) return;
    let abort: AbortController | null = null;
    let lastBbox = '';
    const status = (s: Pipe3DStatus) => latest.current.onStatus(s);

    const load = async () => {
      const view = scene.getView();
      if (!view) return; // 鏡頭在地面下：保留目前的管線
      if (view.zoom < PIPE3D_MIN_ZOOM) {
        status({ kind: 'zoom-in', minZoom: PIPE3D_MIN_ZOOM });
        return;
      }
      const bbox = scene.loadBbox(view);
      if (bbox === lastBbox) return;
      abort?.abort();
      abort = new AbortController();
      status({ kind: 'loading' });
      try {
        const res = await fetch(`/api/pipes3d?bbox=${bbox}&limit=${PIPE3D_LIMIT}`, { signal: abort.signal });
        if (!res.ok) throw new Error(`API 回應 ${res.status}`);
        const data = (await res.json()) as Pipes3DResponse;
        lastBbox = bbox;
        scene.setPipes(data.pipes);
        status({ kind: 'ready', count: data.pipes.length, truncated: data.truncated });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        status({ kind: 'error', message: `無法載入 3D 管線：${(err as Error).message}（API 是否已啟動？）` });
      }
    };

    const off = scene.onMoveEnd(() => void load());
    void load();
    return () => {
      off();
      abort?.abort();
    };
  }, [scene]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ScaleBar settings={p.scaleBar} metersPerPixel={mpp} />
    </div>
  );
}
