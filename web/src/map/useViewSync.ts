// 2D（MapLibre）與 3D（Cesium）視角雙向同步。
// 只由「使用者正在操作的那一邊」帶動另一邊（activeRef），避免兩邊互相觸發成迴圈。
import { useEffect, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { CameraView } from '../types/view';
import type { CesiumScene } from './cesium/CesiumScene';

export type ActivePane = '2d' | '3d';

function readMapView(map: maplibregl.Map): CameraView {
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

export function useViewSync(
  mapRef: RefObject<maplibregl.Map | null>,
  scene: CesiumScene | null,
  activeRef: RefObject<ActivePane>,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !scene) return;

    // 3D 剛建立：先對齊 2D 目前的視角
    scene.applyView(readMapView(map));

    const onMapMove = () => {
      if (activeRef.current === '2d') scene.applyView(readMapView(map));
    };
    map.on('move', onMapMove);

    const off = scene.onViewChange((v) => {
      if (activeRef.current !== '3d') return;
      map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
    });

    return () => {
      map.off('move', onMapMove);
      off();
    };
  }, [mapRef, scene, activeRef]);
}
