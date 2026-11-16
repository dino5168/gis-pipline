import { LandPlot, Layers, Map as MapIcon, TriangleAlert, ZoomIn } from 'lucide-react';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '../map/basemaps';
import type { OverlayId } from '../map/overlays';
import { OverlayControls } from './OverlayControls';
import { PIPE_MIN_ZOOM } from '../config';
import { MaterialLegend } from './MaterialLegend';
import { Pipe3DControls } from './Pipe3DControls';
import type { HeightMode, Pipe3DStatus } from '../types/pipe3d';

interface Props {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  overlays: ReadonlySet<OverlayId>;
  onOverlaysChange: (next: Set<OverlayId>) => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
  enabledMaterials: ReadonlySet<string>;
  onMaterialsChange: (next: Set<string>) => void;
  zoom: number | null;
  tileError: string | null;
  onZoomToPipes: () => void;
  view3d: boolean;
  onView3dChange: (on: boolean) => void;
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  pipe3dStatus: Pipe3DStatus;
}

export function ControlPanel(p: Props) {
  const tooFar = p.zoom !== null && p.zoom < PIPE_MIN_ZOOM;

  return (
    <aside className="panel absolute top-3 left-3 max-h-[calc(100vh-24px)] w-[260px] max-w-[calc(100vw-24px)] overflow-auto rounded-lg p-3.5 text-[13px] shadow-md max-sm:right-3 max-sm:w-auto max-sm:max-h-[45vh]">
      <h1 className="m-0 mb-1 text-[15px] font-semibold">台北市公共管線</h1>
      <div className="text-muted mb-2.5">PostGIS → Martin 向量圖磚</div>

      <h2 className="section-title">
        <MapIcon size={13} /> 底圖
      </h2>
      <select
        className="field w-full p-1"
        value={p.basemap}
        onChange={(e) => p.onBasemapChange(e.target.value as BasemapId)}
      >
        {BASEMAP_IDS.map((id) => (
          <option key={id} value={id}>
            {BASEMAPS[id].name}
          </option>
        ))}
      </select>

      <h2 className="section-title">
        <LandPlot size={13} /> 疊加圖層
      </h2>
      <OverlayControls
        enabled={p.overlays}
        onChange={p.onOverlaysChange}
        opacity={p.overlayOpacity}
        onOpacityChange={p.onOverlayOpacityChange}
      />

      <h2 className="section-title">
        <Layers size={13} /> 管線材料
      </h2>
      <MaterialLegend enabled={p.enabledMaterials} onChange={p.onMaterialsChange} />

      <Pipe3DControls
        view3d={p.view3d}
        onView3dChange={p.onView3dChange}
        heightMode={p.heightMode}
        onHeightModeChange={p.onHeightModeChange}
        exaggeration={p.exaggeration}
        onExaggerationChange={p.onExaggerationChange}
        status={p.pipe3dStatus}
      />

      {p.zoom !== null && <div className="text-muted mt-2.5">縮放等級 {p.zoom.toFixed(1)}</div>}

      {p.tileError ? (
        <div className="mt-2 flex gap-1.5 rounded bg-red-50 px-2 py-1.5 text-red-900 dark:bg-red-950 dark:text-red-200">
          <TriangleAlert size={14} className="mt-0.5 flex-none" />
          <span>{p.tileError}</span>
        </div>
      ) : (
        tooFar && (
          <div className="mt-2 rounded bg-yellow-100 px-2 py-1.5 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
            目前縮放等級 {p.zoom!.toFixed(1)}，管線在 {PIPE_MIN_ZOOM} 以上才會顯示。
            <button className="btn mt-1.5 flex items-center gap-1" onClick={p.onZoomToPipes}>
              <ZoomIn size={13} /> 放大到管線範圍
            </button>
          </div>
        )
      )}
    </aside>
  );
}
