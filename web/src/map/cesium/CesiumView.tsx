// 3D 圖台（Cesium）：第一次需要時才動態載入 Cesium，之後保持存在（隱藏時停止繪製）。
import { useEffect, useRef, useState } from 'react';
import { CESIUM_BASE_URL, PIPE3D_LIMIT, PIPE3D_MIN_ZOOM } from '../../config';
import type { BasemapId } from '../basemaps';
import type { OverlayId } from '../overlays';
import type { Pipe3DOptions, Pipe3DStatus, Pipes3DResponse } from '../../types/pipe3d';
import type { CesiumScene } from './CesiumScene';
import { bboxParam, covers, loadArea, visibleArea, type LoadedArea } from './loadArea';
import { ScaleBar } from '../../components/ScaleBar';
import { Navigation3D } from '../../components/Navigation3D';
import { metersPerPixel } from '../cameraScale';
import { setPointerLngLat } from '../pointerCoord';
import type { ScaleBarSettings } from '../../types/scaleBar';
import { PIPE_KIND_IDS, type PipeColorMode, type PipeKindId } from '../../types/pipeKind';

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
  /** 要顯示的管線種類（各自向 API 載入） */
  enabledKinds: ReadonlySet<PipeKindId>;
  colorMode: PipeColorMode;
  pipe3dOptions: Pipe3DOptions;
  /** 地面不透明度 0～1 */
  groundOpacity: number;
  /** 左上角顯示 FPS（效能量測用） */
  showFps: boolean;
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
          kinds: cur.enabledKinds,
          colorMode: cur.colorMode,
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
  useEffect(() => scene?.setShowFps(p.showFps), [scene, p.showFps]);

  // ---- 管線選項、材料篩選
  useEffect(() => scene?.setPipeOptions(p.pipe3dOptions), [scene, p.pipe3dOptions]);
  useEffect(() => scene?.setMaterials(p.enabledMaterials), [scene, p.enabledMaterials]);
  useEffect(() => scene?.setKinds(p.enabledKinds), [scene, p.enabledKinds]);
  useEffect(() => scene?.setColorMode(p.colorMode), [scene, p.colorMode]);

  // 各種類已載入的範圍（畫面還在範圍內就不重抓；關閉再打開時也沿用）
  const loadedArea = useRef(new Map<PipeKindId, LoadedArea>());
  const loadedResult = useRef(new Map<PipeKindId, { count: number; truncated: boolean }>());

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

  // ---- 鏡頭停止、或勾選的種類改變時，依畫面範圍載入勾選的管線種類
  const { enabledKinds } = p;
  useEffect(() => {
    if (!scene) return;
    const abort = new AbortController();
    const status = (s: Pipe3DStatus) => latest.current.onStatus(s);
    const kinds = PIPE_KIND_IDS.filter((k) => enabledKinds.has(k));
    let seq = 0;

    const summary = (): Pipe3DStatus => {
      let count = 0, truncated = false;
      for (const k of kinds) {
        const r = loadedResult.current.get(k);
        if (r) {
          count += r.count;
          truncated ||= r.truncated;
        }
      }
      return { kind: 'ready', count, truncated };
    };

    const load = async () => {
      const mine = ++seq;
      if (kinds.length === 0) return status({ kind: 'off' });
      const view = scene.getView();
      if (!view) return; // 鏡頭在地面下：保留目前的管線
      if (view.zoom < PIPE3D_MIN_ZOOM) return status({ kind: 'zoom-in', minZoom: PIPE3D_MIN_ZOOM });
      const center: [number, number] = [view.lng, view.lat];
      const viewBbox = scene.viewBbox(view);
      const visible = visibleArea(viewBbox, center);
      const todo = kinds.filter((k) => {
        const area = loadedArea.current.get(k);
        return !area || !covers(area, visible, center);
      });
      if (todo.length === 0) return status(summary());
      const bbox = loadArea(viewBbox, center);
      status({ kind: 'loading' });
      try {
        await Promise.all(
          todo.map(async (k) => {
            const url = `/api/pipes3d?bbox=${bboxParam(bbox)}&limit=${PIPE3D_LIMIT}&layer=${k}`;
            const res = await fetch(url, { signal: abort.signal });
            if (!res.ok) throw new Error(`API 回應 ${res.status}`);
            const data = (await res.json()) as Pipes3DResponse;
            if (abort.signal.aborted) return;
            loadedArea.current.set(k, { bbox, center, truncated: data.truncated });
            loadedResult.current.set(k, { count: data.pipes.length, truncated: data.truncated });
            scene.setPipes(k, data.pipes);
          }),
        );
        if (mine === seq) status(summary());
      } catch (err) {
        if ((err as Error).name === 'AbortError' || abort.signal.aborted) return;
        status({ kind: 'error', message: `無法載入 3D 管線：${(err as Error).message}（API 是否已啟動？）` });
      }
    };

    const off = scene.onMoveEnd(() => void load());
    void load();
    return () => {
      off();
      abort.abort();
    };
  }, [scene, enabledKinds]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ScaleBar settings={p.scaleBar} metersPerPixel={mpp} />
      {scene && <Navigation3D scene={scene} />}
    </div>
  );
}
