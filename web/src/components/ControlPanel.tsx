import { LandPlot, Layers, Map as MapIcon, TriangleAlert, ZoomIn } from 'lucide-react';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '../map/basemaps';
import type { OverlayId } from '../map/overlays';
import { OverlayControls } from './OverlayControls';
import { PIPE_MIN_ZOOM } from '../config';
import { MaterialLegend } from './MaterialLegend';
import { Pipe3DControls } from './Pipe3DControls';
import type { HeightMode, Pipe3DStatus } from '../types/pipe3d';
import { PanelSection, WARNING_ALERT } from './PanelSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

interface Props {
  /** 2D／3D 圖台是否顯示中（決定要顯示哪些設定） */
  show2d: boolean;
  show3d: boolean;
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
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  groundOpacity: number;
  onGroundOpacityChange: (v: number) => void;
  pipe3dStatus: Pipe3DStatus;
}

export function ControlPanel(p: Props) {
  const tooFar = p.show2d && p.zoom !== null && p.zoom < PIPE_MIN_ZOOM;

  return (
    <Card
      size="sm"
      className="bg-card/95 absolute top-3 left-3 z-40 max-h-[calc(100%-24px)] w-[280px] max-w-[calc(100vw-24px)] overflow-auto shadow-md backdrop-blur-sm max-sm:right-3 max-sm:max-h-[45vh] max-sm:w-auto"
    >
      <CardContent className="space-y-4">
        <PanelSection icon={<MapIcon />} title="底圖">
          <Select value={p.basemap} onValueChange={(v) => p.onBasemapChange(v as BasemapId)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {BASEMAP_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {BASEMAPS[id].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelSection>

        <PanelSection icon={<LandPlot />} title="疊加圖層">
          <OverlayControls
            enabled={p.overlays}
            onChange={p.onOverlaysChange}
            opacity={p.overlayOpacity}
            onOpacityChange={p.onOverlayOpacityChange}
          />
        </PanelSection>

        <PanelSection icon={<Layers />} title="管線材料">
          <MaterialLegend enabled={p.enabledMaterials} onChange={p.onMaterialsChange} />
        </PanelSection>

        {p.show3d && (
          <Pipe3DControls
            heightMode={p.heightMode}
            onHeightModeChange={p.onHeightModeChange}
            exaggeration={p.exaggeration}
            onExaggerationChange={p.onExaggerationChange}
            groundOpacity={p.groundOpacity}
            onGroundOpacityChange={p.onGroundOpacityChange}
            status={p.pipe3dStatus}
          />
        )}

        <Separator />

        {p.show2d && p.zoom !== null && <div className="text-muted-foreground text-xs">縮放等級 {p.zoom.toFixed(1)}</div>}

        {p.tileError ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{p.tileError}</AlertDescription>
          </Alert>
        ) : (
          tooFar && (
            <Alert className={WARNING_ALERT}>
              <AlertDescription className="text-inherit">
                目前縮放等級 {p.zoom!.toFixed(1)}，管線在 {PIPE_MIN_ZOOM} 以上才會顯示。
                <Button variant="outline" size="xs" className="mt-1.5" onClick={p.onZoomToPipes}>
                  <ZoomIn /> 放大到管線範圍
                </Button>
              </AlertDescription>
            </Alert>
          )
        )}
      </CardContent>
    </Card>
  );
}
