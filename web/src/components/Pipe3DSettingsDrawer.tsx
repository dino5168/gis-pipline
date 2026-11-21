import { X } from 'lucide-react';
import {
  HEIGHT_MODE_LABELS,
  SECTION_MODE_LABELS,
  type HeightMode,
  type Pipe3DStatus,
  type SectionMode,
} from '../types/pipe3d';
import type { TerrainId } from '../map/terrain';
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { WARNING_ALERT } from './PanelSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  section: SectionMode;
  onSectionChange: (m: SectionMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  /** 地形來源（在「圖層」選單切換） */
  terrain: TerrainId;
  /** 地形垂直放大倍率（與管線分開） */
  terrainExaggeration: number;
  onTerrainExaggerationChange: (k: number) => void;
  /** 地面不透明度 0～1 */
  groundOpacity: number;
  onGroundOpacityChange: (v: number) => void;
  /** 允許鏡頭進入地面下 */
  underground: boolean;
  onUndergroundChange: (v: boolean) => void;
  /** 左上角顯示 FPS（效能量測用） */
  showFps: boolean;
  onShowFpsChange: (v: boolean) => void;
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
                  <SelectItem key={m} value={m} disabled={m === 'z' && p.terrain === 'none'}>
                    {HEIGHT_MODE_LABELS[m]}
                    {m === 'z' && p.terrain === 'none' && '（需先開啟地形）'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {p.terrain === 'none' && (
              <p className="text-muted-foreground text-xs">
                Z 值是海拔高度，要有地形當地面才對得上；請先在「圖層 → 地形」開啟地形。
              </p>
            )}
            {p.heightMode !== 'z' && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <span className="inline-block size-3 shrink-0 rounded-sm" style={{ background: PIPE3D_NO_DEPTH_COLOR }} />
                埋深缺值的管線（管頂貼地面顯示；只缺一端時用另一端的埋深）
              </p>
            )}
            {p.terrain !== 'none' && p.heightMode !== 'z' && (
              <Alert className={WARNING_ALERT}>
                <AlertDescription className="text-inherit">
                  已開啟地形，但埋深模式仍以高度 0 為地面，管線不會貼齊地形（地勢高處管線會顯得很深）。和地形對照請改用「Z 值（絕對高程）」。
                </AlertDescription>
              </Alert>
            )}
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
            <Label className={SECTION_LABEL}>
              {p.heightMode === 'z' ? '管徑放大' : '管線垂直／管徑放大'} ×{p.exaggeration}
            </Label>
            <Slider min={1} max={20} step={1} value={[p.exaggeration]} onValueChange={([v]) => p.onExaggerationChange(v)} />
          </div>
          {p.terrain !== 'none' && (
            <div className="space-y-2">
              <Label className={SECTION_LABEL}>
                {p.heightMode === 'z' ? '地形與管線高度垂直放大' : '地形垂直放大'} ×{p.terrainExaggeration}
              </Label>
              <Slider
                min={1}
                max={5}
                step={0.5}
                value={[p.terrainExaggeration]}
                onValueChange={([v]) => p.onTerrainExaggerationChange(v)}
              />
              {p.heightMode === 'z' && (
                <p className="text-muted-foreground text-xs">Z 值模式下管線高度與地形用同一個倍率，兩者才對得上。</p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>地面不透明度 {Math.round(p.groundOpacity * 100)}%</Label>
            <Slider min={0} max={1} step={0.05} value={[p.groundOpacity]} onValueChange={([v]) => p.onGroundOpacityChange(v)} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="pipe3d-underground" className={SECTION_LABEL}>
              允許鏡頭進入地面下（從地底往上看管線）
            </Label>
            <Switch id="pipe3d-underground" checked={p.underground} onCheckedChange={p.onUndergroundChange} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="pipe3d-fps" className={SECTION_LABEL}>
              顯示 FPS（效能量測，畫面靜止時不更新）
            </Label>
            <Switch id="pipe3d-fps" checked={p.showFps} onCheckedChange={p.onShowFpsChange} />
          </div>
          <div className="text-muted-foreground text-xs">
            左鍵拖曳平移、右鍵拖曳或滾輪縮放、中鍵（或 Ctrl＋左鍵）拖曳旋轉傾斜。
            {p.underground ? '鏡頭可以移到地面下。' : '鏡頭保持在地面上；要從地底看請開啟上面的「允許鏡頭進入地面下」。'}
          </div>
          <Pipe3DStatusLine status={p.status} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
