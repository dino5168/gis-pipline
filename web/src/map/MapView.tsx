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
// 2D 傾斜停用中，恢復時一併匯入 MAP_MAX_PITCH
import { TAIPEI_CENTER, TILES_BASE } from '../config';
import { BASEMAPS, BASEMAP_IDS, basemapLayerId, type BasemapId } from './basemaps';
import { OVERLAYS, OVERLAY_IDS, overlayLayerId, type OverlayId } from './overlays';
import { TERRAINS, TERRAIN_IDS, hillshadeLayerId, terrainSourceId, type TerrainId } from './terrain';
import {
  PIPE_SOURCES,
  allPipeLayers,
  materialFilter,
  pipeCasingLayerId,
  pipeColor,
  pipeLayerId,
} from './pipeStyle';
import { PipeAttributeTable } from '../components/PipeAttributeTable';
import { ScaleBar } from '../components/ScaleBar';
import { MapZoomControls } from '../components/MapZoomControls';
import { MeasureControl } from '../components/MeasureControl';
import { MeasureTool } from './measureTool';
import { DrawControl } from '../components/DrawControl';
import { DrawTool } from './drawTool';
import type { DrawMode, DrawStatus, DrawStyle } from '../types/draw';
import type { MeasureResult } from './measure';
import type { MeasureMode, MeasureStyle } from '../types/measure';
import { metersPerPixel } from './cameraScale';
import { setPointerLngLat } from './pointerCoord';
import type { ScaleBarSettings } from '../types/scaleBar';
import type { CoordDisplaySettings } from '../types/coordSystem';
import { CommandLineEngine } from './commandLine';
import { CommandHelpDrawer } from '../components/CommandHelpDrawer';
import { CommandLineWindow } from '../components/CommandLineWindow';
import type { CommandLineState } from '../types/commandLine';
import type { PipeProperties } from '../types/pipe';
import { ProfileTool } from './profileTool';
import { ProfileWindow } from '../components/ProfileWindow';
import type { LngLat } from '../types/profile';
import {
  PIPE_KINDS,
  PIPE_KIND_BY_ID,
  PIPE_KIND_IDS,
  isPipeKindId,
  type PipeColorMode,
  type PipeKindId,
} from '../types/pipeKind';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface Props {
  basemap: BasemapId;
  overlays: ReadonlySet<OverlayId>;
  /** 疊加圖層不透明度 0～1 */
  overlayOpacity: number;
  /** 地形：2D 以陰影地形（hillshade）顯示 */
  terrain: TerrainId;
  enabledMaterials: ReadonlySet<string>;
  /** 要顯示的管線種類 */
  enabledKinds: ReadonlySet<PipeKindId>;
  colorMode: PipeColorMode;
  scaleBar: ScaleBarSettings;
  /** 量測線條樣式（設定 → 樣式） */
  measureStyle: MeasureStyle;
  /** 繪圖圖形樣式（設定 → 樣式） */
  drawStyle: DrawStyle;
  /** 坐標系設定（命令列輸入、回顯坐標用） */
  coordDisplay: CoordDisplaySettings;
  /** 視窗 → 2D 命令列 */
  commandLineOpen: boolean;
  onCommandLineClose: () => void;
  /** 分析 → 剖面分析 */
  profileOpen: boolean;
  onProfileClose: () => void;
  /** 讓上層取得地圖實體（例如 flyTo） */
  mapRef: RefObject<maplibregl.Map | null>;
  onZoomChange: (zoom: number) => void;
  onTileError: (message: string) => void;
}

interface Selection {
  kind: PipeKindId;
  id: string | number;
  props: Partial<PipeProperties>;
}

/** 全部管線種類的本體圖層（滑過、點選用） */
const PIPE_LAYER_IDS = PIPE_KIND_IDS.map(pipeLayerId);

/** 圖徵 → feature-state 用的識別（source 依管線種類不同） */
const featureId = (f: { source: string; sourceLayer?: string; id: string | number }): FeatureIdentifier => ({
  source: f.source,
  sourceLayer: f.sourceLayer,
  id: f.id,
});

function buildStyle(initialBasemap: BasemapId, initialColorMode: PipeColorMode): maplibregl.StyleSpecification {
  const sources: Record<string, SourceSpecification> = {};
  for (const src of PIPE_SOURCES) sources[src.id] = { type: 'vector', url: src.url };
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
  // 陰影地形：在底圖之上、疊加圖層之下，預設隱藏（由 effect 切換）
  for (const id of TERRAIN_IDS) {
    const src = TERRAINS[id].source;
    if (!src) continue;
    sources[terrainSourceId(id)] = src;
    layers.push({
      id: hillshadeLayerId(id),
      type: 'hillshade',
      source: terrainSourceId(id),
      layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#3d4a55', 'hillshade-highlight-color': '#ffffff' },
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
  layers.push(...allPipeLayers(initialColorMode));
  return { version: 8, sources, layers };
}

/**
 * 地圖樣式載入後執行 apply（已載入就立即執行）；回傳的清除函式給 useEffect 用，
 * 避免依賴改變時舊的 apply 還在等 load。
 */
function whenStyleLoaded(map: maplibregl.Map | null, apply: (map: maplibregl.Map) => void): (() => void) | undefined {
  if (!map) return;
  if (map.isStyleLoaded()) {
    apply(map);
    return;
  }
  const onLoad = () => apply(map);
  map.once('load', onLoad);
  return () => {
    map.off('load', onLoad);
  };
}

export function MapView({
  basemap,
  overlays,
  overlayOpacity,
  terrain,
  enabledMaterials,
  enabledKinds,
  colorMode,
  scaleBar,
  measureStyle,
  drawStyle,
  coordDisplay,
  commandLineOpen,
  onCommandLineClose,
  profileOpen,
  onProfileClose,
  mapRef,
  onZoomChange,
  onTileError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [popupNode] = useState(() => document.createElement('div'));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mpp, setMpp] = useState<number | null>(null);
  // ---- 量測
  const measureRef = useRef<MeasureTool | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode | null>(null);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  // ---- 繪圖（與量測互斥）
  const drawRef = useRef<DrawTool | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [drawStatus, setDrawStatus] = useState<DrawStatus | null>(null);
  const changeDrawMode = (mode: DrawMode | null) => {
    setDrawMode(mode);
    drawRef.current?.setMode(mode);
  };
  const closeDraw = () => {
    setDrawOpen(false);
    setDrawMode(null);
    drawRef.current?.setOpen(false);
  };
  const closeDrawRef = useRef(closeDraw);
  closeDrawRef.current = closeDraw;
  const changeDrawModeRef = useRef(changeDrawMode);
  changeDrawModeRef.current = changeDrawMode;
  const changeMeasureMode = (mode: MeasureMode | null) => {
    setMeasureMode(mode);
    measureRef.current?.setMode(mode);
  };
  const closeMeasure = () => {
    setMeasureOpen(false);
    changeMeasureMode(null);
  };
  const closeMeasureRef = useRef(closeMeasure);
  closeMeasureRef.current = closeMeasure;
  // ---- 命令列（命令執行中與量測、繪圖互斥）
  const cmdRef = useRef<CommandLineEngine | null>(null);
  const [cmdState, setCmdState] = useState<CommandLineState | null>(null);
  /** 命令說明面板（HELP、?、F1）；topic＝要標示的命令 */
  const [cmdHelp, setCmdHelp] = useState<{ open: boolean; topic: string | null }>({ open: false, topic: null });
  // ---- 剖面分析（畫線中與量測、繪圖、命令互斥）
  const profileRef = useRef<ProfileTool | null>(null);
  const [profileLine, setProfileLine] = useState<[LngLat, LngLat] | null>(null);
  const [profileDrawing, setProfileDrawing] = useState(false);
  const stopProfileDrawing = () => {
    profileRef.current?.stopDrawing();
    setProfileDrawing(false);
  };
  const stopProfileDrawingRef = useRef(stopProfileDrawing);
  stopProfileDrawingRef.current = stopProfileDrawing;
  const startProfileDrawing = () => {
    cmdRef.current?.cancel();
    closeMeasureRef.current();
    closeDrawRef.current();
    setProfileLine(null);
    profileRef.current?.startDrawing();
    setProfileDrawing(true);
  };
  const startProfileDrawingRef = useRef(startProfileDrawing);
  startProfileDrawingRef.current = startProfileDrawing;

  // 用 ref 保存最新的 callback，避免地圖重建
  const cb = useRef({ onZoomChange, onTileError });
  cb.current = { onZoomChange, onTileError };

  // ---- 建立地圖（只執行一次）
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildStyle(basemap, colorMode),
      center: TAIPEI_CENTER,
      zoom: 15,
      maxZoom: 21,
      // 2D 圖台只做 2D：傾斜功能先停用（保留旋轉）。要恢復傾斜：改回 maxPitch: MAP_MAX_PITCH，
      // 並拿掉 pitchWithRotate / touchPitch 兩行（MapZoomControls 的重設視角會一併歸零傾斜）。
      // maxPitch: MAP_MAX_PITCH,
      maxPitch: 0,
      pitchWithRotate: false, // 右鍵／Ctrl 拖曳只旋轉，不傾斜
      touchPitch: false, // 雙指上下拖曳不傾斜
      hash: true,
      // 出處改顯示在左下角比例尺旁（見下方 attribution）
      attributionControl: false,
    });
    mapRef.current = map;
    // 放大／重設視角／縮小改用與 3D 相同的 MapZoomControls（取代 MapLibre 內建 NavigationControl）

    const reportZoom = () => cb.current.onZoomChange(map.getZoom());
    map.on('zoom', reportZoom);
    map.on('load', reportZoom);
    // 比例尺：以畫面中心的地面解析度計算（取代 MapLibre 內建 ScaleControl）
    const reportScale = () => setMpp(metersPerPixel(map.getZoom(), map.getCenter().lat));
    map.on('move', reportScale);
    map.on('load', reportScale);
    map.on('error', (e) => {
      const err = e as maplibregl.ErrorEvent & { sourceId?: string };
      if (err.sourceId?.startsWith('pipes-') || String(err.error?.message ?? '').includes(TILES_BASE)) {
        cb.current.onTileError(`無法連線圖磚服務 ${TILES_BASE}，請先執行 tiles\\start-martin.ps1（新增管線種類後要重啟 Martin）。`);
      }
    });

    // ---- 坐標顯示：滑鼠所在位置
    map.on('mousemove', (e) => setPointerLngLat({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.getCanvasContainer().addEventListener('mouseleave', () => setPointerLngLat(null));

    // ---- 量測（量測中暫停管線滑過／點選）
    const measure = new MeasureTool(map, {
      onChange: setMeasureResult,
      onExit: () => closeMeasureRef.current(),
    });
    measureRef.current = measure;
    const draw = new DrawTool(map, {
      onChange: (s) => {
        setDrawStatus(s);
        // 圖形被編輯、刪除、復原時更新命令列的選取醒目顯示
        cmdRef.current?.refresh();
      },
      onModeRequest: (mode) => changeDrawModeRef.current(mode),
      onExit: () => closeDrawRef.current(),
    });
    drawRef.current = draw;
    const cmd = new CommandLineEngine(map, {
      onChange: setCmdState,
      onHelp: (topic) => setCmdHelp({ open: true, topic }),
      onStart: () => {
        closeMeasureRef.current();
        closeDrawRef.current();
        stopProfileDrawingRef.current();
      },
      sink: draw,
    });
    cmdRef.current = cmd;
    cmd.emit();
    const profile = new ProfileTool(map, {
      onComplete: (line) => {
        setProfileLine(line);
        setProfileDrawing(false);
      },
      onCancel: () => setProfileDrawing(false),
    });
    profileRef.current = profile;
    /** 量測、繪圖、命令執行或畫剖面線中：暫停管線滑過／點選 */
    const busy = () => measure.active || draw.active || cmd.active || profile.active;

    // ---- 滑過
    let hover: FeatureIdentifier | null = null;
    const sameFeature = (a: FeatureIdentifier, b: FeatureIdentifier) => a.source === b.source && a.id === b.id;
    map.on('mousemove', PIPE_LAYER_IDS, (e) => {
      if (busy()) return;
      const f = e.features?.[0];
      if (!f || f.id === undefined) return;
      const fid = featureId({ source: f.source, sourceLayer: f.sourceLayer, id: f.id });
      map.getCanvas().style.cursor = 'pointer';
      if (hover && !sameFeature(hover, fid)) map.setFeatureState(hover, { hover: false });
      hover = fid;
      map.setFeatureState(fid, { hover: true });
    });
    map.on('mouseleave', PIPE_LAYER_IDS, () => {
      if (!busy()) map.getCanvas().style.cursor = '';
      if (hover) map.setFeatureState(hover, { hover: false });
      hover = null;
    });

    // ---- 點選：屬性視窗內容由 React 透過 portal 繪製
    let selected: FeatureIdentifier | null = null;
    let detailAbort: AbortController | null = null;
    // 屬性表分 2 排，視窗放寬
    const popup = new maplibregl.Popup({ maxWidth: '36rem' }).setDOMContent(popupNode);
    popup.on('close', () => {
      detailAbort?.abort();
      detailAbort = null;
      if (selected) map.setFeatureState(selected, { selected: false });
      selected = null;
      setSelection(null);
    });
    map.on('click', PIPE_LAYER_IDS, (e) => {
      if (busy()) return;
      // 多種管線重疊時取最上層的那條
      const f = e.features?.[0];
      if (!f || f.id === undefined || !isPipeKindId(f.sourceLayer)) return;
      popup.remove(); // 先關閉舊視窗（觸發 close 清除舊選取），再設定新選取
      selected = featureId({ source: f.source, sourceLayer: f.sourceLayer, id: f.id });
      map.setFeatureState(selected, { selected: true });
      const kind = f.sourceLayer;
      const id = f.id;
      setSelection({ kind, id, props: f.properties as Partial<PipeProperties> });
      popup.setLngLat(e.lngLat).addTo(map);
      // 小比例尺（z12～13）預產圖磚只帶畫圖用的欄位，完整屬性向 API 取；取到後覆蓋圖磚屬性
      const ctrl = new AbortController();
      detailAbort = ctrl;
      fetch(`/api/pipes/${encodeURIComponent(String(id))}?layer=${encodeURIComponent(kind)}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<{ properties: Partial<PipeProperties> }>) : null))
        .then((detail) => {
          if (!detail || ctrl.signal.aborted) return;
          setSelection((cur) =>
            cur && cur.kind === kind && cur.id === id ? { ...cur, props: { ...cur.props, ...detail.properties } } : cur,
          );
        })
        .catch(() => {}); // 取消或連線失敗：保留圖磚屬性
    });

    return () => {
      profile.destroy();
      profileRef.current = null;
      cmd.destroy();
      cmdRef.current = null;
      measure.destroy();
      measureRef.current = null;
      draw.destroy();
      drawRef.current = null;
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 量測樣式
  useEffect(() => {
    measureRef.current?.setStyle(measureStyle);
  }, [measureStyle]);
  useEffect(() => {
    drawRef.current?.setStyle(drawStyle);
  }, [drawStyle]);
  // ---- 命令列
  useEffect(() => {
    cmdRef.current?.setCoordSettings(coordDisplay);
  }, [coordDisplay]);
  useEffect(() => {
    if (!commandLineOpen) cmdRef.current?.cancel();
  }, [commandLineOpen]);
  // ---- 剖面分析：開啟時直接開始畫線，關閉時清除
  useEffect(() => {
    if (profileOpen) startProfileDrawingRef.current();
    else {
      profileRef.current?.clear();
      setProfileLine(null);
      setProfileDrawing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileOpen]);

  // ---- 底圖切換
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        for (const id of BASEMAP_IDS) {
          if (!BASEMAPS[id].source) continue;
          map.setLayoutProperty(basemapLayerId(id), 'visibility', id === basemap ? 'visible' : 'none');
        }
      }),
    [basemap],
  );

  // ---- 疊加圖層（地籍等）顯示與不透明度
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        for (const id of OVERLAY_IDS) {
          map.setLayoutProperty(overlayLayerId(id), 'visibility', overlays.has(id) ? 'visible' : 'none');
          map.setPaintProperty(overlayLayerId(id), 'raster-opacity', overlayOpacity);
        }
      }),
    [overlays, overlayOpacity],
  );

  // ---- 陰影地形
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        for (const id of TERRAIN_IDS) {
          if (!TERRAINS[id].source) continue;
          map.setLayoutProperty(hillshadeLayerId(id), 'visibility', id === terrain ? 'visible' : 'none');
        }
      }),
    [terrain],
  );

  // ---- 材料篩選
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        const filter = materialFilter(enabledMaterials);
        for (const k of PIPE_KIND_IDS) {
          map.setFilter(pipeLayerId(k), filter);
          map.setFilter(pipeCasingLayerId(k), filter);
        }
      }),
    [enabledMaterials],
  );

  // ---- 管線種類顯示
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        for (const k of PIPE_KIND_IDS) {
          const v = enabledKinds.has(k) ? 'visible' : 'none';
          map.setLayoutProperty(pipeLayerId(k), 'visibility', v);
          map.setLayoutProperty(pipeCasingLayerId(k), 'visibility', v);
        }
      }),
    [enabledKinds],
  );

  // ---- 著色方式
  useEffect(
    () =>
      whenStyleLoaded(mapRef.current, (map) => {
        for (const k of PIPE_KINDS) map.setPaintProperty(pipeLayerId(k.id), 'line-color', pipeColor(k, colorMode));
      }),
    [colorMode],
  );

  // ---- 出處：目前底圖＋開啟的疊加圖層（政府資料開放授權須顯名）
  const bm = BASEMAPS[basemap].source?.attribution;
  const attribution = [
    ...new Set(
      [bm, TERRAINS[terrain].source?.attribution, ...[...overlays].map((id) => OVERLAYS[id].source.attribution)].filter(Boolean),
    ),
    'MapLibre',
  ].join(' | ');

  return (
    <div className="relative h-full w-full">
      {/* 不能用 absolute inset-0：maplibre-gl.css 的 .maplibregl-map{position:relative} 未分層，
          會蓋過 Tailwind 4（在 @layer 內）的 absolute，容器高度變 0 */}
      <div ref={containerRef} className="h-full w-full" />
      {selection &&
        createPortal(
          <PipeAttributeTable title={PIPE_KIND_BY_ID[selection.kind].name} id={selection.id} props={selection.props} />,
          popupNode,
        )}
      <MapZoomControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onReset={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0 })}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />
      {/* 左側中間：量測、繪圖（兩者互斥，開一個就關另一個） */}
      <div className="absolute top-1/2 left-3 z-40 flex -translate-y-1/2 flex-col items-start gap-2">
        <MeasureControl
          open={measureOpen}
          mode={measureMode}
          result={measureResult}
          onToggleOpen={() => {
            if (measureOpen) closeMeasure();
            else {
              cmdRef.current?.cancel();
              stopProfileDrawing();
              closeDraw();
              // 展開時預設距離量測
              setMeasureOpen(true);
              changeMeasureMode('distance');
            }
          }}
          onModeChange={changeMeasureMode}
        />
        <DrawControl
          open={drawOpen}
          mode={drawMode}
          status={drawStatus}
          onToggleOpen={() => {
            if (drawOpen) closeDraw();
            else {
              cmdRef.current?.cancel();
              stopProfileDrawing();
              closeMeasure();
              setDrawOpen(true);
              drawRef.current?.setOpen(true);
            }
          }}
          onModeChange={changeDrawMode}
          onUndo={() => drawRef.current?.undo()}
          onImport={(data) => {
            const r = drawRef.current?.importGeoJSON(data);
            if (!r) return '繪圖尚未就緒';
            if (r.bounds) mapRef.current?.fitBounds(r.bounds, { padding: 80, maxZoom: 18 });
            const skipped = r.skipped ? `，${r.skipped} 個無法匯入（坐標須為 WGS84 經緯度）` : '';
            return `已匯入 ${r.added} 個圖形${skipped}`;
          }}
          onExport={() => drawRef.current?.exportGeoJSON() ?? null}
          onClear={() => drawRef.current?.clearAll()}
        />
      </div>
      {commandLineOpen && cmdState && (
        <CommandLineWindow
          state={cmdState}
          onSubmit={(t) => cmdRef.current?.submit(t)}
          onCancel={() => cmdRef.current?.cancel()}
          onClose={onCommandLineClose}
          onHelp={() => cmdRef.current?.help()}
        />
      )}
      {profileOpen && (
        <ProfileWindow
          line={profileLine}
          drawing={profileDrawing}
          enabledKinds={enabledKinds}
          onRedraw={startProfileDrawing}
          onClose={onProfileClose}
          onPoints={(pts) => profileRef.current?.setPoints(pts)}
          onHover={(i) => profileRef.current?.setHighlight(i)}
        />
      )}
      <CommandHelpDrawer
        open={cmdHelp.open}
        onOpenChange={(open) => setCmdHelp((h) => ({ ...h, open }))}
        topic={cmdHelp.topic}
      />
      <ScaleBar settings={scaleBar} metersPerPixel={mpp} attribution={attribution} />
    </div>
  );
}
