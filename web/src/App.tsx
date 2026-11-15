import { useCallback, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { MapView } from './map/MapView';
import { ControlPanel } from './components/ControlPanel';
import { ALL_MATERIAL_CODES } from './map/pipeStyle';
import type { BasemapId } from './map/basemaps';
import { DATA_BOUNDS, PIPES_CENTER } from './config';

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('emap');
  const [enabledMaterials, setEnabledMaterials] = useState<Set<string>>(
    () => new Set(ALL_MATERIAL_CODES),
  );
  const [zoom, setZoom] = useState<number | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);

  // 畫面中心在資料範圍內就原地放大，否則飛到台北市中心
  const zoomToPipes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const [w, s, e, n] = DATA_BOUNDS;
    const inside = c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n;
    map.flyTo({ center: inside ? c : PIPES_CENTER, zoom: 14 });
  }, []);

  return (
    <div className="relative h-full w-full">
      <MapView
        basemap={basemap}
        enabledMaterials={enabledMaterials}
        mapRef={mapRef}
        onZoomChange={setZoom}
        onTileError={setTileError}
      />
      <ControlPanel
        basemap={basemap}
        onBasemapChange={setBasemap}
        enabledMaterials={enabledMaterials}
        onMaterialsChange={setEnabledMaterials}
        zoom={zoom}
        tileError={tileError}
        onZoomToPipes={zoomToPipes}
      />
    </div>
  );
}
