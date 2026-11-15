import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import {
  type FeatureIdentifier,
  type LayerSpecification,
  type SourceSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PIPE_SOURCE_LAYER, PIPE_TILEJSON, TAIPEI_CENTER } from '../config';
import { BASEMAPS, BASEMAP_IDS, basemapLayerId, type BasemapId } from './basemaps';
import {
  PIPE_CASING_LAYER_ID,
  PIPE_LAYER_ID,
  PIPE_SOURCE_ID,
  materialFilter,
  pipeLayers,
} from './pipeStyle';
import { PipeAttributeTable } from '../components/PipeAttributeTable';
import type { PipeProperties } from '../types/pipe';

interface Props {
  basemap: BasemapId;
  enabledMaterials: ReadonlySet<string>;
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
  layers.push(...pipeLayers);
  return { version: 8, sources, layers };
}

export function MapView({ basemap, enabledMaterials, mapRef, onZoomChange, onTileError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [popupNode] = useState(() => document.createElement('div'));
  const [selection, setSelection] = useState<Selection | null>(null);

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
      hash: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const reportZoom = () => cb.current.onZoomChange(map.getZoom());
    map.on('zoom', reportZoom);
    map.on('load', reportZoom);
    map.on('error', (e) => {
      const err = e as maplibregl.ErrorEvent & { sourceId?: string };
      if (err.sourceId === PIPE_SOURCE_ID || String(err.error?.message ?? '').includes(PIPE_TILEJSON)) {
        cb.current.onTileError(`無法連線圖磚服務 ${PIPE_TILEJSON}，請先執行 tiles\\start-martin.ps1。`);
      }
    });

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

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {selection &&
        createPortal(<PipeAttributeTable id={selection.id} props={selection.props} />, popupNode)}
    </>
  );
}
