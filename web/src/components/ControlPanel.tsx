import { Layers, TriangleAlert, ZoomIn } from 'lucide-react';
import { PIPE_MIN_ZOOM } from '../config';
import { MaterialLegend } from './MaterialLegend';
import { Pipe3DControls } from './Pipe3DControls';
import type { HeightMode, Pipe3DStatus } from '../types/pipe3d';
import { PanelSection, WARNING_ALERT } from './PanelSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface Props {
  /** 2D／3D 圖台是否顯示中（決定要顯示哪些設定） */
  show2d: boolean;
  show3d: boolean;
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
