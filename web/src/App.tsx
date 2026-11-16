import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { MapView } from './map/MapView';
import { CesiumView } from './map/cesium/CesiumView';
import type { CesiumScene } from './map/cesium/CesiumScene';
import { useViewSync, type ActivePane } from './map/useViewSync';
import { AppMenu } from './components/AppMenu';
import { ControlPanel } from './components/ControlPanel';
import { SplitView, clampRatio } from './components/SplitView';
import { ALL_MATERIAL_CODES } from './map/pipeStyle';
import type { BasemapId } from './map/basemaps';
import type { OverlayId } from './map/overlays';
import { DATA_BOUNDS, GROUND_OPACITY_DEFAULT, PIPES_CENTER } from './config';
import type { HeightMode, Pipe3DStatus } from './types/pipe3d';
import type { ViewMode } from './types/view';
import { ScaleBarSettingsDrawer } from './components/ScaleBarSettingsDrawer';
import { CoordinateDisplay } from './components/CoordinateDisplay';
import { CoordSettingsDrawer } from './components/CoordSettingsDrawer';
import {
  DEFAULT_COORD_DISPLAY,
  LNGLAT_DECIMALS_RANGE,
  XY_DECIMALS_RANGE,
  isCoordSystem,
  type CoordDisplaySettings,
} from './types/coordSystem';
import {
  DEFAULT_SCALE_BAR,
  SCALE_BAR_MAX_WIDTH_RANGE,
  SCALE_BAR_STYLES,
  type ScaleBarSettings,
} from './types/scaleBar';

// 版面偏好（只存在這台瀏覽器；讀寫失敗時用預設值）
const STORE_KEY = 'utl.layout';
function loadLayout(): { mode: ViewMode; ratio: number } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { mode?: ViewMode; ratio?: number };
    return {
      mode: v.mode === '2d' || v.mode === '3d' || v.mode === 'split' ? v.mode : '2d',
      ratio: typeof v.ratio === 'number' ? clampRatio(v.ratio) : 0.5,
    };
  } catch {
    return { mode: '2d', ratio: 0.5 };
  }
}

// 比例尺設定（只存在這台瀏覽器；不合法的欄位用預設值）
const SCALE_STORE_KEY = 'utl.scaleBar';
function loadScaleBar(): ScaleBarSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SCALE_STORE_KEY) ?? '{}') as Partial<ScaleBarSettings>;
    const d = DEFAULT_SCALE_BAR;
    const { min, max } = SCALE_BAR_MAX_WIDTH_RANGE;
    return {
      visible: typeof v.visible === 'boolean' ? v.visible : d.visible,
      style: SCALE_BAR_STYLES.some((s) => s.id === v.style) ? v.style! : d.style,
      unit: v.unit === 'metric' || v.unit === 'imperial' ? v.unit : d.unit,
      maxWidth: typeof v.maxWidth === 'number' ? Math.min(Math.max(v.maxWidth, min), max) : d.maxWidth,
    };
  } catch {
    return DEFAULT_SCALE_BAR;
  }
}

// 坐標顯示設定（只存在這台瀏覽器；不合法的欄位用預設值）
const COORD_STORE_KEY = 'utl.coordDisplay';
function loadCoordDisplay(): CoordDisplaySettings {
  const d = DEFAULT_COORD_DISPLAY;
  const int = (v: unknown, r: { min: number; max: number }, def: number) =>
    typeof v === 'number' && Number.isInteger(v) ? Math.min(Math.max(v, r.min), r.max) : def;
  try {
    const v = JSON.parse(localStorage.getItem(COORD_STORE_KEY) ?? '{}') as Partial<CoordDisplaySettings>;
    return {
      visible: typeof v.visible === 'boolean' ? v.visible : d.visible,
      system: isCoordSystem(v.system) ? v.system : d.system,
      lngLatDecimals: int(v.lngLatDecimals, LNGLAT_DECIMALS_RANGE, d.lngLatDecimals),
      xDecimals: int(v.xDecimals, XY_DECIMALS_RANGE, d.xDecimals),
      yDecimals: int(v.yDecimals, XY_DECIMALS_RANGE, d.yDecimals),
    };
  } catch {
    return d;
  }
}

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [initialLayout] = useState(loadLayout);
  const [mode, setMode] = useState<ViewMode>(initialLayout.mode);
  const [splitRatio, setSplitRatio] = useState(initialLayout.ratio);
  const [basemap, setBasemap] = useState<BasemapId>('emap');
  const [overlays, setOverlays] = useState<Set<OverlayId>>(() => new Set());
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [enabledMaterials, setEnabledMaterials] = useState<Set<string>>(
    () => new Set(ALL_MATERIAL_CODES),
  );
  const [zoom, setZoom] = useState<number | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [heightMode, setHeightMode] = useState<HeightMode>('depth-top');
  const [exaggeration, setExaggeration] = useState(5);
  const [groundOpacity, setGroundOpacity] = useState(GROUND_OPACITY_DEFAULT);
  const [pipe3dStatus, setPipe3dStatus] = useState<Pipe3DStatus>({ kind: 'off' });
  const [scaleBar, setScaleBar] = useState<ScaleBarSettings>(loadScaleBar);
  const [scaleSettingsOpen, setScaleSettingsOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(SCALE_STORE_KEY, JSON.stringify(scaleBar));
    } catch {
      // 無法儲存時忽略
    }
  }, [scaleBar]);
  const [coordDisplay, setCoordDisplay] = useState<CoordDisplaySettings>(loadCoordDisplay);
  const [coordSettingsOpen, setCoordSettingsOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(COORD_STORE_KEY, JSON.stringify(coordDisplay));
    } catch {
      // 無法儲存時忽略
    }
  }, [coordDisplay]);
  const pipe3dOptions = useMemo(() => ({ heightMode, exaggeration }), [heightMode, exaggeration]);

  // ---- 3D：第一次切到含 3D 的模式才建立 Cesium，之後保留
  const show2d = mode !== '3d';
  const show3d = mode !== '2d';
  const [cesiumMounted, setCesiumMounted] = useState(show3d);
  useEffect(() => {
    if (show3d) setCesiumMounted(true);
  }, [show3d]);
  const [scene, setScene] = useState<CesiumScene | null>(null);

  // ---- 視角同步：由使用者正在操作的一邊帶動另一邊
  const activeRef = useRef<ActivePane>(mode === '3d' ? '3d' : '2d');
  useEffect(() => {
    if (mode !== 'split') activeRef.current = mode;
  }, [mode]);
  const activate = useCallback((pane: ActivePane) => {
    activeRef.current = pane;
  }, []);
  useViewSync(mapRef, scene, activeRef);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode, ratio: splitRatio }));
    } catch {
      // 無法儲存（隱私模式等）時忽略
    }
  }, [mode, splitRatio]);

  // 畫面中心在資料範圍內就原地放大，否則飛到台北市中心（由 2D 帶動，3D 跟著同步）
  const zoomToPipes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    activeRef.current = '2d';
    const c = map.getCenter();
    const [w, s, e, n] = DATA_BOUNDS;
    const inside = c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n;
    map.flyTo({ center: inside ? c : PIPES_CENTER, zoom: 14 });
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <AppMenu
        mode={mode}
        onModeChange={setMode}
        basemap={basemap}
        onBasemapChange={setBasemap}
        overlays={overlays}
        onOverlaysChange={setOverlays}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={setOverlayOpacity}
        onOpenScaleSettings={() => setScaleSettingsOpen(true)}
        onOpenCoordSettings={() => setCoordSettingsOpen(true)}
      />
      <ScaleBarSettingsDrawer
        open={scaleSettingsOpen}
        onOpenChange={setScaleSettingsOpen}
        settings={scaleBar}
        onChange={setScaleBar}
      />
      <CoordSettingsDrawer
        open={coordSettingsOpen}
        onOpenChange={setCoordSettingsOpen}
        settings={coordDisplay}
        onChange={setCoordDisplay}
      />
      <div className="relative flex min-h-0 flex-1">
        <SplitView
          mode={mode}
          ratio={splitRatio}
          onRatioChange={setSplitRatio}
          onActivate={activate}
          left={
            <MapView
              basemap={basemap}
              overlays={overlays}
              overlayOpacity={overlayOpacity}
              enabledMaterials={enabledMaterials}
              scaleBar={scaleBar}
              mapRef={mapRef}
              onZoomChange={setZoom}
              onTileError={setTileError}
            />
          }
          right={
            cesiumMounted && (
              <CesiumView
                visible={show3d}
                basemap={basemap}
                overlays={overlays}
                overlayOpacity={overlayOpacity}
                enabledMaterials={enabledMaterials}
                pipe3dOptions={pipe3dOptions}
                groundOpacity={groundOpacity}
                scaleBar={scaleBar}
                onStatus={setPipe3dStatus}
                onReady={setScene}
              />
            )
          }
        />
        <CoordinateDisplay settings={coordDisplay} />
        <ControlPanel
          show2d={show2d}
          show3d={show3d}
          enabledMaterials={enabledMaterials}
          onMaterialsChange={setEnabledMaterials}
          zoom={zoom}
          tileError={tileError}
          onZoomToPipes={zoomToPipes}
          heightMode={heightMode}
          onHeightModeChange={setHeightMode}
          exaggeration={exaggeration}
          onExaggerationChange={setExaggeration}
          groundOpacity={groundOpacity}
          onGroundOpacityChange={setGroundOpacity}
          pipe3dStatus={pipe3dStatus}
        />
      </div>
    </div>
  );
}
