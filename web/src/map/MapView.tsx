import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import {
  type FeatureIdentifier,
  type LayerSpecification,
  type SourceSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 預設從主程式旁邊載入 worker，但 Vite 會把主程式預先打包到 .vite/deps，
// 那裡沒有 worker 檔 → 地圖整張不畫。改成明確指定 worker 位址。
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MAP_MAX_PITCH, PIPE_SOURCE_LAYER, PIPE_TILEJSON, TAIPEI_CENTER } from '../config';
import { BASEMAPS, BASEMAP_IDS, basemapLayerId, type BasemapId } from './basemaps';
import { OVERLAYS, OVERLAY_IDS, overlayLayerId, type OverlayId } from './overlays';
import {
  PIPE_CASING_LAYER_ID,
  PIPE_LAYER_ID,
  PIPE_SOURCE_ID,
  materialFilter,
  pipeLayers,
} from './pipeStyle';
import { PipeAttributeTable } from '../components/PipeAttributeTable';
import { ScaleBar } from '../components/ScaleBar';
import { metersPerPixel } from './cameraScale';
import { setPointerLngLat } from './pointerCoord';
import type { ScaleBarSettings } from '../types/scaleBar';
import type { PipeProperties } from '../types/pipe';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface Props {
  basemap: BasemapId;
  overlays: ReadonlySet<OverlayId>;
  /** 疊加圖層不透明度 0～1 */
  overlayOpacity: number;
  enabledMaterials: ReadonlySet<string>;
  scaleBar: ScaleBarSettings;
  /** 讓上層取得地圖實體（例如 flyTo） */
  mapRef: RefObject<maplibregl.Map | null>;
  onZoomChange: (zoom: number) => void;
  onTileError: (message: string) => void;
}

interface Selection {
  id: string | number;
  props: Partial<PipeProperties>;
}

const featureId = (id: string | number): FeatureIdentifier => ({
  source: PIPE_SOURCE_ID,
  sourceLayer: PIPE_SOURCE_LAYER,
  id,
});

function buildStyle(initialBasemap: BasemapId): maplibregl.StyleSpecification {
  const sources: Record<string, SourceSpecification> = {
    [PIPE_SOURCE_ID]: { type: 'vector', url: PIPE_TILEJSON },
  };
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#f6f8fa' } },
  ];
  for (const id of BASEMAP_IDS) {
    const src = BASEMAPS[id].source;
    if (!src) continue;
    sources[basemapLayerId(id)] = src;
    layers.push({
      id: basemapLayerId(id),
      type: 'raster',
      source: basemapLayerId(id),
      layout: { visibility: id === initialBasemap ? 'visible' : 'none' },
    });
  }
  // 疊加圖層：在底圖之上、管線之下，預設隱藏（由 effect 依勾選切換）
  for (const id of OVERLAY_IDS) {
    sources[overlayLayerId(id)] = OVERLAYS[id].source;
    layers.push({
      id: overlayLayerId(id),
      type: 'raster',
      source: overlayLayerId(id),
      layout: { visibility: 'none' },
    });
  }
  layers.push(...pipeLayers);
  return { version: 8, sources, layers };
}

export function MapView({
  basemap,
  overlays,
  overlayOpacity,
  enabledMaterials,
  scaleBar,
  mapRef,
  onZoomChange,
  onTileError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [popupNode] = useState(() => document.createElement('div'));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mpp, setMpp] = useState<number | null>(null);

  // 用 ref 保存最新的 callback，避免地圖重建
  const cb = useRef({ onZoomChange, onTileError });
  cb.current = { onZoomChange, onTileError };

  // ---- 建立地圖（只執行一次）
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildStyle(basemap),
      center: TAIPEI_CENTER,
      zoom: 15,
      maxZoom: 21,
      maxPitch: MAP_MAX_PITCH,
      hash: true,
      // 出處改顯示在左下角比例尺旁（見下方 attribution）
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const reportZoom = () => cb.current.onZoomChange(map.getZoom());
    map.on('zoom', reportZoom);
    map.on('load', reportZoom);
    // 比例尺：以畫面中心的地面解析度計算（取代 MapLibre 內建 ScaleControl）
    const reportScale = () => setMpp(metersPerPixel(map.getZoom(), map.getCenter().lat));
    map.on('move', reportScale);
    map.on('load', reportScale);
    map.on('error', (e) => {
      const err = e as maplibregl.ErrorEvent & { sourceId?: string };
      if (err.sourceId === PIPE_SOURCE_ID || String(err.error?.message ?? '').includes(PIPE_TILEJSON)) {
        cb.current.onTileError(`無法連線圖磚服務 ${PIPE_TILEJSON}，請先執行 tiles\\start-martin.ps1。`);
      }
    });

    // ---- 坐標顯示：滑鼠所在位置
    map.on('mousemove', (e) => setPointerLngLat({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.getCanvasContainer().addEventListener('mouseleave', () => setPointerLngLat(null));

    // ---- 滑過
    let hoverId: string | number | null = null;
    map.on('mousemove', PIPE_LAYER_ID, (e) => {
      const id = e.features?.[0]?.id;
      if (id === undefined) return;
      map.getCanvas().style.cursor = 'pointer';
      if (hoverId !== null && hoverId !== id) map.setFeatureState(featureId(hoverId), { hover: false });
      hoverId = id;
      map.setFeatureState(featureId(id), { hover: true });
    });
    map.on('mouseleave', PIPE_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      if (hoverId !== null) map.setFeatureState(featureId(hoverId), { hover: false });
      hoverId = null;
    });

    // ---- 點選：屬性視窗內容由 React 透過 portal 繪製
    let selectedId: string | number | null = null;
    const popup = new maplibregl.Popup({ maxWidth: '340px' }).setDOMContent(popupNode);
    popup.on('close', () => {
      if (selectedId !== null) map.setFeatureState(featureId(selectedId), { selected: false });
      selectedId = null;
      setSelection(null);
    });
    map.on('click', PIPE_LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f || f.id === undefined) return;
      popup.remove(); // 先關閉舊視窗（觸發 close 清除舊選取），再設定新選取
      selectedId = f.id;
      map.setFeatureState(featureId(f.id), { selected: true });
      setSelection({ id: f.id, props: f.properties as Partial<PipeProperties> });
      popup.setLngLat(e.lngLat).addTo(map);
    });

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 底圖切換
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const id of BASEMAP_IDS) {
        if (!BASEMAPS[id].source) continue;
        map.setLayoutProperty(basemapLayerId(id), 'visibility', id === basemap ? 'visible' : 'none');
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [basemap, mapRef]);

  // ---- 疊加圖層（地籍等）顯示與不透明度
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const id of OVERLAY_IDS) {
        map.setLayoutProperty(overlayLayerId(id), 'visibility', overlays.has(id) ? 'visible' : 'none');
        map.setPaintProperty(overlayLayerId(id), 'raster-opacity', overlayOpacity);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [overlays, overlayOpacity, mapRef]);

  // ---- 材料篩選
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const filter = materialFilter(enabledMaterials);
      map.setFilter(PIPE_LAYER_ID, filter);
      map.setFilter(PIPE_CASING_LAYER_ID, filter);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [enabledMaterials, mapRef]);

  // ---- 出處：目前底圖＋開啟的疊加圖層（政府資料開放授權須顯名）
  const bm = BASEMAPS[basemap].source?.attribution;
  const attribution = [
    ...new Set([bm, ...[...overlays].map((id) => OVERLAYS[id].source.attribution)].filter(Boolean)),
    'MapLibre',
  ].join(' | ');

  return (
    <div className="relative h-full w-full">
      {/* 不能用 absolute inset-0：maplibre-gl.css 的 .maplibregl-map{position:relative} 未分層，
          會蓋過 Tailwind 4（在 @layer 內）的 absolute，容器高度變 0 */}
      <div ref={containerRef} className="h-full w-full" />
      {selection &&
        createPortal(<PipeAttributeTable id={selection.id} props={selection.props} />, popupNode)}
      <ScaleBar settings={scaleBar} metersPerPixel={mpp} attribution={attribution} />
    </div>
  );
}
