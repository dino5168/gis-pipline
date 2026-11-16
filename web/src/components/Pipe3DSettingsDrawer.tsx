import { X } from 'lucide-react';
import {
  HEIGHT_MODE_LABELS,
  SECTION_MODE_LABELS,
  type HeightMode,
  type Pipe3DStatus,
  type SectionMode,
} from '../types/pipe3d';
import { Pipe3DStatusLine } from './MapStatus';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  section: SectionMode;
  onSectionChange: (m: SectionMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  /** 地面不透明度 0～1 */
  groundOpacity: number;
  onGroundOpacityChange: (v: number) => void;
  status: Pipe3DStatus;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';

/** 管線 → 3D 顯示設定：從右邊彈出的 Drawer（原本在地圖左上角的 3D 檢視面板） */
export function Pipe3DSettingsDrawer(p: Props) {
  return (
    <Drawer open={p.open} onOpenChange={p.onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>3D 顯示設定</DrawerTitle>
            <DrawerDescription>3D 圖台（Cesium）的管線高度、放大倍率與地面</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>高度依據</Label>
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
            <Label className={SECTION_LABEL}>斷面</Label>
            <Select value={p.section} onValueChange={(v) => p.onSectionChange(v as SectionMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(Object.keys(SECTION_MODE_LABELS) as SectionMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {SECTION_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              有寬×高的管線（電信）以外包絡畫方形；多條小管依共管條數排成格狀。
            </p>
          </div>
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>垂直／管徑放大 ×{p.exaggeration}</Label>
            <Slider min={1} max={20} step={1} value={[p.exaggeration]} onValueChange={([v]) => p.onExaggerationChange(v)} />
          </div>
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>地面不透明度 {Math.round(p.groundOpacity * 100)}%</Label>
            <Slider min={0} max={1} step={0.05} value={[p.groundOpacity]} onValueChange={([v]) => p.onGroundOpacityChange(v)} />
          </div>
          <div className="text-muted-foreground text-xs">
            左鍵拖曳平移、右鍵拖曳或滾輪縮放、中鍵（或 Ctrl＋左鍵）拖曳旋轉傾斜；可以把鏡頭移到地面下。
          </div>
          <Pipe3DStatusLine status={p.status} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
