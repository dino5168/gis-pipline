import { useCallback, useMemo, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { MapView } from './map/MapView';
import { ControlPanel } from './components/ControlPanel';
import { ALL_MATERIAL_CODES } from './map/pipeStyle';
import type { BasemapId } from './map/basemaps';
import type { OverlayId } from './map/overlays';
import { DATA_BOUNDS, PIPES_CENTER } from './config';
import type { HeightMode, Pipe3DStatus } from './types/pipe3d';

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('emap');
  const [overlays, setOverlays] = useState<Set<OverlayId>>(() => new Set());
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [enabledMaterials, setEnabledMaterials] = useState<Set<string>>(
    () => new Set(ALL_MATERIAL_CODES),
  );
  const [zoom, setZoom] = useState<number | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [view3d, setView3d] = useState(false);
  const [heightMode, setHeightMode] = useState<HeightMode>('depth-top');
  const [exaggeration, setExaggeration] = useState(5);
  const [pipe3dStatus, setPipe3dStatus] = useState<Pipe3DStatus>({ kind: 'off' });
  const pipe3dOptions = useMemo(() => ({ heightMode, exaggeration }), [heightMode, exaggeration]);

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
        overlays={overlays}
        overlayOpacity={overlayOpacity}
        enabledMaterials={enabledMaterials}
        mapRef={mapRef}
        onZoomChange={setZoom}
        onTileError={setTileError}
        view3d={view3d}
        pipe3dOptions={pipe3dOptions}
        onPipe3DStatus={setPipe3dStatus}
      />
      <ControlPanel
        basemap={basemap}
        onBasemapChange={setBasemap}
        overlays={overlays}
        onOverlaysChange={setOverlays}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={setOverlayOpacity}
        enabledMaterials={enabledMaterials}
        onMaterialsChange={setEnabledMaterials}
        zoom={zoom}
        tileError={tileError}
        onZoomToPipes={zoomToPipes}
        view3d={view3d}
        onView3dChange={setView3d}
        heightMode={heightMode}
        onHeightModeChange={setHeightMode}
        exaggeration={exaggeration}
        onExaggerationChange={setExaggeration}
        pipe3dStatus={pipe3dStatus}
      />
    </div>
  );
}
