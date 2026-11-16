import { Box, TriangleAlert } from 'lucide-react';
import { HEIGHT_MODE_LABELS, type HeightMode, type Pipe3DStatus } from '../types/pipe3d';
import { PanelSection, WARNING_ALERT } from './PanelSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

interface Props {
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  /** 地面不透明度 0～1 */
  groundOpacity: number;
  onGroundOpacityChange: (v: number) => void;
  status: Pipe3DStatus;
}

function StatusLine({ status }: { status: Pipe3DStatus }) {
  switch (status.kind) {
    case 'off':
      return null;
    case 'loading':
      return <div className="text-muted-foreground text-xs">載入中…</div>;
    case 'zoom-in':
      return (
        <Alert className={WARNING_ALERT}>
          <AlertDescription className="text-inherit">
            放大到縮放等級 {status.minZoom} 以上才會載入 3D 管線。
          </AlertDescription>
        </Alert>
      );
    case 'ready':
      return (
        <div className="text-muted-foreground text-xs">
          已載入 {status.count.toLocaleString()} 條管線
          {status.truncated && '（已達上限，只顯示離畫面中心較近的部分）'}
        </div>
      );
    case 'error':
      return (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      );
  }
}

export function Pipe3DControls(p: Props) {
  return (
    <PanelSection icon={<Box />} title="3D 檢視（Cesium）">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs font-normal">高度依據</Label>
          <Select value={p.heightMode} onValueChange={(v) => p.onHeightModeChange(v as HeightMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {(Object.keys(HEIGHT_MODE_LABELS) as HeightMode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {HEIGHT_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs font-normal">
            垂直／管徑放大 ×{p.exaggeration}
          </Label>
          <Slider
            min={1}
            max={20}
            step={1}
            value={[p.exaggeration]}
            onValueChange={([v]) => p.onExaggerationChange(v)}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs font-normal">
            地面不透明度 {Math.round(p.groundOpacity * 100)}%
          </Label>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[p.groundOpacity]}
            onValueChange={([v]) => p.onGroundOpacityChange(v)}
          />
        </div>
        <div className="text-muted-foreground text-xs">
          左鍵拖曳平移、右鍵拖曳或滾輪縮放、中鍵（或 Ctrl＋左鍵）拖曳旋轉傾斜；可以把鏡頭移到地面下。
        </div>
      </div>
      <StatusLine status={p.status} />
    </PanelSection>
  );
}
