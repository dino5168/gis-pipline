import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { MapView } from './map/MapView';
import { CesiumView } from './map/cesium/CesiumView';
import type { CesiumScene } from './map/cesium/CesiumScene';
import { useViewSync, type ActivePane } from './map/useViewSync';
import { AppMenu } from './components/AppMenu';
import { MapStatus } from './components/MapStatus';
import { MaterialFilterDrawer } from './components/MaterialFilterDrawer';
import { Pipe3DSettingsDrawer } from './components/Pipe3DSettingsDrawer';
import { PIPE_KIND_IDS, type PipeColorMode, type PipeKindId } from './types/pipeKind';
import { SplitView, clampRatio } from './components/SplitView';
import { ALL_MATERIAL_CODES } from './map/pipeStyle';
import type { BasemapId } from './map/basemaps';
import type { OverlayId } from './map/overlays';
import type { TerrainId } from './map/terrain';
import { DATA_BOUNDS, GROUND_OPACITY_DEFAULT, PIPES_CENTER } from './config';
import type { HeightMode, Pipe3DStatus, SectionMode } from './types/pipe3d';
import type { ViewMode } from './types/view';
import { ScaleBarSettingsDrawer } from './components/ScaleBarSettingsDrawer';
import { CoordinateDisplay } from './components/CoordinateDisplay';
import { CoordSettingsDrawer } from './components/CoordSettingsDrawer';
import { StyleSettingsDrawer } from './components/StyleSettingsDrawer';
import { SystemStyleDrawer } from './components/SystemStyleDrawer';
import { applySystemStyle } from './lib/theme';
import { parseSystemStyle, SYSTEM_STYLE_KEY } from './types/systemStyle';
import { parseMeasureStyle } from './types/measure';
import { parseDrawStyle } from './types/draw';
import { parseCoordDisplay } from './types/coordSystem';
import { parseScaleBar } from './types/scaleBar';
import { readStored, usePersistentState, writeStored } from './lib/storage';
import { AddressSearch } from './components/AddressSearch';
import { TitleTooltip } from './components/TitleTooltip';
import { flyToSearchResult, setSearchMarker } from './map/searchMarker';
import type { GeocodeResult } from './types/geocode';

// 版面偏好（只存在這台瀏覽器；讀寫失敗時用預設值）
const LAYOUT_STORE_KEY = 'utl.layout';
const VIEW_MODES: { id: ViewMode }[] = [{ id: '2d' }, { id: '3d' }, { id: 'split' }];
function parseLayout(v: Record<string, unknown>): { mode: ViewMode; ratio: number } {
  return {
    mode: VIEW_MODES.find((m) => m.id === v.mode)?.id ?? '2d',
    ratio: typeof v.ratio === 'number' && Number.isFinite(v.ratio) ? clampRatio(v.ratio) : 0.5,
  };
}

/** 視窗開關（只存在這台瀏覽器） */
function parseWindows(v: Record<string, unknown>): { commandLine2d: boolean } {
  return { commandLine2d: v.commandLine2d === true };
}

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [initialLayout] = useState(() => readStored(LAYOUT_STORE_KEY, parseLayout));
  const [mode, setMode] = useState<ViewMode>(initialLayout.mode);
  const [splitRatio, setSplitRatio] = useState(initialLayout.ratio);
  const [basemap, setBasemap] = useState<BasemapId>('emap');
  const [overlays, setOverlays] = useState<Set<OverlayId>>(() => new Set());
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [terrain, setTerrain] = useState<TerrainId>('none');
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [enabledMaterials, setEnabledMaterials] = useState<Set<string>>(
    () => new Set(ALL_MATERIAL_CODES),
  );
  const [enabledKinds, setEnabledKinds] = useState<Set<PipeKindId>>(() => new Set(PIPE_KIND_IDS));
  const [colorMode, setColorMode] = useState<PipeColorMode>('kind');
  const [materialFilterOpen, setMaterialFilterOpen] = useState(false);
  const [pipe3dSettingsOpen, setPipe3dSettingsOpen] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [heightMode, setHeightMode] = useState<HeightMode>('depth-top');
  const [section, setSection] = useState<SectionMode>('box');
  const [exaggeration, setExaggeration] = useState(5);
  const [groundOpacity, setGroundOpacity] = useState(GROUND_OPACITY_DEFAULT);
  const [showFps, setShowFps] = useState(false);
  const [underground, setUnderground] = useState(false);
  const [pipe3dStatus, setPipe3dStatus] = useState<Pipe3DStatus>({ kind: 'off' });
  const [scaleBar, setScaleBar] = usePersistentState('utl.scaleBar', parseScaleBar);
  const [scaleSettingsOpen, setScaleSettingsOpen] = useState(false);
  const [coordDisplay, setCoordDisplay] = usePersistentState('utl.coordDisplay', parseCoordDisplay);
  const [coordSettingsOpen, setCoordSettingsOpen] = useState(false);
  const [measureStyle, setMeasureStyle] = usePersistentState('utl.measureStyle', parseMeasureStyle);
  const [styleSettingsOpen, setStyleSettingsOpen] = useState(false);
  const [drawStyle, setDrawStyle] = usePersistentState('utl.drawStyle', parseDrawStyle);
  const [windows, setWindows] = usePersistentState('utl.windows', parseWindows);
  const [systemStyle, setSystemStyle] = usePersistentState(SYSTEM_STYLE_KEY, parseSystemStyle);
  const [systemStyleOpen, setSystemStyleOpen] = useState(false);
  // 分析 → 剖面分析（不記住，每次重開都重新畫剖面線）
  const [profileOpen, setProfileOpen] = useState(false);
  const openProfile = () => {
    // 剖面線畫在 2D 圖台：只有 3D 時切到並排
    if (mode === '3d') setMode('split');
    setClashOpen(false);
    setProfileOpen(true);
  };
  // 分析 → 衝突檢核（不記住；與剖面分析同時只開一個，都在 2D 圖台畫線）
  const [clashOpen, setClashOpen] = useState(false);
  const openClash = () => {
    if (mode === '3d') setMode('split');
    setProfileOpen(false);
    setClashOpen(true);
  };
  useEffect(() => applySystemStyle(systemStyle), [systemStyle]);
  const commandLine2d = windows.commandLine2d;
  const setCommandLine2d = useCallback(
    (open: boolean) => setWindows((w) => ({ ...w, commandLine2d: open })),
    [setWindows],
  );
  // Z 值（絕對高程）需要地形當地面才有意義：關掉地形時改回埋深（量到管頂）
  const changeTerrain = useCallback((t: TerrainId) => {
    setTerrain(t);
    if (t === 'none') setHeightMode((m) => (m === 'z' ? 'depth-top' : m));
  }, []);
  const pipe3dOptions = useMemo(() => ({ heightMode, section, exaggeration }), [heightMode, section, exaggeration]);

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
  // 程式帶動 2D 飛行（門牌定位）期間鎖住操作方，避免滑鼠剛好移到 3D 上方就改由 3D 帶動、3D 不再跟著飛
  const flyingRef = useRef(false);
  const activate = useCallback((pane: ActivePane) => {
    if (!flyingRef.current) activeRef.current = pane;
  }, []);
  useViewSync(mapRef, scene, activeRef);

  useEffect(() => writeStored(LAYOUT_STORE_KEY, { mode, ratio: splitRatio }), [mode, splitRatio]);

  // 畫面中心在資料範圍內就原地放大，否則飛到台北市中心（由 2D 帶動，3D 跟著同步）
  const zoomToPipes = useCallback((zoom: number) => {
    const map = mapRef.current;
    if (!map) return;
    activeRef.current = '2d';
    const c = map.getCenter();
    const [w, s, e, n] = DATA_BOUNDS;
    const inside = c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n;
    map.flyTo({ center: inside ? c : PIPES_CENTER, zoom: Math.max(zoom, map.getZoom()) });
  }, []);

  // ---- 門牌搜尋：2D 飛過去（3D 由視角同步跟著），兩邊都標記
  const [searchResult, setSearchResult] = useState<GeocodeResult | null>(null);
  const locate = useCallback((r: GeocodeResult) => {
    setSearchResult(r);
    const map = mapRef.current;
    if (!map) return;
    activeRef.current = '2d';
    flyingRef.current = true;
    map.once('moveend', () => {
      flyingRef.current = false;
    });
    flyToSearchResult(map, r);
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (map) setSearchMarker(map, searchResult);
  }, [searchResult]);
  useEffect(() => {
    scene?.setSearchMarker(searchResult);
  }, [scene, searchResult]);

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
        terrain={terrain}
        onTerrainChange={changeTerrain}
        enabledKinds={enabledKinds}
        onKindsChange={setEnabledKinds}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        onOpenMaterialFilter={() => setMaterialFilterOpen(true)}
        onOpenPipe3DSettings={() => setPipe3dSettingsOpen(true)}
        onOpenScaleSettings={() => setScaleSettingsOpen(true)}
        onOpenCoordSettings={() => setCoordSettingsOpen(true)}
        onOpenStyleSettings={() => setStyleSettingsOpen(true)}
        onOpenSystemStyle={() => setSystemStyleOpen(true)}
        commandLine2d={commandLine2d}
        onCommandLine2dChange={setCommandLine2d}
        onOpenProfile={openProfile}
        onOpenClash={openClash}
        search={<AddressSearch onSelect={locate} onClear={() => setSearchResult(null)} />}
      />
      <MaterialFilterDrawer
        open={materialFilterOpen}
        onOpenChange={setMaterialFilterOpen}
        enabled={enabledMaterials}
        onChange={setEnabledMaterials}
      />
      <Pipe3DSettingsDrawer
        open={pipe3dSettingsOpen}
        onOpenChange={setPipe3dSettingsOpen}
        heightMode={heightMode}
        onHeightModeChange={setHeightMode}
        section={section}
        onSectionChange={setSection}
        exaggeration={exaggeration}
        onExaggerationChange={setExaggeration}
        terrain={terrain}
        terrainExaggeration={terrainExaggeration}
        onTerrainExaggerationChange={setTerrainExaggeration}
        groundOpacity={groundOpacity}
        onGroundOpacityChange={setGroundOpacity}
        underground={underground}
        onUndergroundChange={setUnderground}
        showFps={showFps}
        onShowFpsChange={setShowFps}
        status={pipe3dStatus}
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
      <StyleSettingsDrawer
        open={styleSettingsOpen}
        onOpenChange={setStyleSettingsOpen}
        measureStyle={measureStyle}
        onMeasureStyleChange={setMeasureStyle}
        drawStyle={drawStyle}
        onDrawStyleChange={setDrawStyle}
      />
      <SystemStyleDrawer
        open={systemStyleOpen}
        onOpenChange={setSystemStyleOpen}
        settings={systemStyle}
        onChange={setSystemStyle}
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
              terrain={terrain}
              enabledMaterials={enabledMaterials}
              enabledKinds={enabledKinds}
              colorMode={colorMode}
              scaleBar={scaleBar}
              measureStyle={measureStyle}
              drawStyle={drawStyle}
              coordDisplay={coordDisplay}
              commandLineOpen={commandLine2d}
              onCommandLineClose={() => setCommandLine2d(false)}
              profileOpen={profileOpen}
              onProfileOpen={openProfile}
              onProfileClose={() => setProfileOpen(false)}
              clashOpen={clashOpen}
              onClashOpen={openClash}
              onClashClose={() => setClashOpen(false)}
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
                terrain={terrain}
                terrainExaggeration={terrainExaggeration}
                enabledMaterials={enabledMaterials}
                enabledKinds={enabledKinds}
                colorMode={colorMode}
                pipe3dOptions={pipe3dOptions}
                groundOpacity={groundOpacity}
                underground={underground}
                showFps={showFps}
                scaleBar={scaleBar}
                measureStyle={measureStyle}
                mapRef={mapRef}
                onStatus={setPipe3dStatus}
                onReady={setScene}
              />
            )
          }
        />
        <CoordinateDisplay settings={coordDisplay} />
        <MapStatus
          show2d={show2d}
          show3d={show3d}
          zoom={zoom}
          enabledKinds={enabledKinds}
          tileError={tileError}
          pipe3dStatus={pipe3dStatus}
          onZoomTo={zoomToPipes}
        />
      </div>
      <TitleTooltip />
    </div>
  );
}
