// 3D 檢視的開關、資料載入與選項套用。Three.js 圖層模組在第一次開啟時才動態載入。
import { useEffect, useRef, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { PIPE3D_LIMIT, PIPE3D_MIN_ZOOM, PIPE3D_PITCH } from '../config';
import { PIPE_CASING_LAYER_ID, PIPE_LAYER_ID } from './pipeStyle';
import type { Pipe3DOptions, Pipe3DStatus, Pipes3DResponse } from '../types/pipe3d';
import type { Pipe3DLayer } from './pipes3d/Pipe3DLayer';

/** 與 API 的 PIPES3D_MAX_SPAN 一致（度） */
const MAX_SPAN = 0.1;

/** 畫面範圍（傾斜時可能延伸很遠），以中心為準限制跨度 */
function viewBbox(map: maplibregl.Map): string {
  const b = map.getBounds();
  const c = map.getCenter();
  const half = MAX_SPAN / 2 - 1e-6;
  const w = Math.max(b.getWest(), c.lng - half);
  const e = Math.min(b.getEast(), c.lng + half);
  const s = Math.max(b.getSouth(), c.lat - half);
  const n = Math.min(b.getNorth(), c.lat + half);
  return [w, s, e, n].map((v) => v.toFixed(6)).join(',');
}

export function usePipe3D(
  mapRef: RefObject<maplibregl.Map | null>,
  enabled: boolean,
  options: Pipe3DOptions,
  onStatus: (s: Pipe3DStatus) => void,
) {
  const layerRef = useRef<Pipe3DLayer | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  // ---- 開關
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) return;
    let cancelled = false;
    let abort: AbortController | null = null;
    let lastBbox = '';

    const load = async () => {
      const layer = layerRef.current;
      if (!layer) return;
      if (map.getZoom() < PIPE3D_MIN_ZOOM) {
        statusRef.current({ kind: 'zoom-in', minZoom: PIPE3D_MIN_ZOOM });
        return;
      }
      const bbox = viewBbox(map);
      if (bbox === lastBbox) return;
      abort?.abort();
      abort = new AbortController();
      statusRef.current({ kind: 'loading' });
      try {
        const res = await fetch(`/api/pipes3d?bbox=${bbox}&limit=${PIPE3D_LIMIT}`, { signal: abort.signal });
        if (!res.ok) throw new Error(`API 回應 ${res.status}`);
        const data = (await res.json()) as Pipes3DResponse;
        if (cancelled) return;
        lastBbox = bbox;
        layer.setData(data.pipes);
        statusRef.current({ kind: 'ready', count: data.pipes.length, truncated: data.truncated });
      } catch (err) {
        if ((err as Error).name === 'AbortError' || cancelled) return;
        statusRef.current({ kind: 'error', message: `無法載入 3D 管線：${(err as Error).message}（API 是否已啟動？）` });
      }
    };

    const start = async () => {
      statusRef.current({ kind: 'loading' });
      const { Pipe3DLayer } = await import('./pipes3d/Pipe3DLayer');
      if (cancelled) return;
      const layer = new Pipe3DLayer(optionsRef.current);
      layerRef.current = layer;
      map.addLayer(layer);
      map.setLayoutProperty(PIPE_LAYER_ID, 'visibility', 'none');
      map.setLayoutProperty(PIPE_CASING_LAYER_ID, 'visibility', 'none');
      map.on('moveend', load);
      if (map.getPitch() < 30) map.easeTo({ pitch: PIPE3D_PITCH, duration: 800 });
      else void load();
    };

    if (map.isStyleLoaded()) void start();
    else map.once('load', () => void start());

    return () => {
      cancelled = true;
      abort?.abort();
      map.off('moveend', load);
      statusRef.current({ kind: 'off' });
      // 地圖已被 MapView 移除（元件卸載）時不必還原
      if (mapRef.current !== map) {
        layerRef.current = null;
        return;
      }
      if (layerRef.current) {
        map.removeLayer(layerRef.current.id);
        layerRef.current = null;
      }
      map.setLayoutProperty(PIPE_LAYER_ID, 'visibility', 'visible');
      map.setLayoutProperty(PIPE_CASING_LAYER_ID, 'visibility', 'visible');
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    };
  }, [enabled, mapRef]);

  // ---- 選項（高度依據、放大倍率）
  useEffect(() => {
    layerRef.current?.setOptions(options);
  }, [options]);
}
