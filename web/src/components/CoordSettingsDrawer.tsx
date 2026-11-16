import { X } from 'lucide-react';
import { formatCoord } from './CoordinateDisplay';
import { NumberStepper } from './NumberStepper';
import {
  COORD_SYSTEMS,
  LNGLAT_DECIMALS_RANGE,
  XY_DECIMALS_RANGE,
  type CoordDisplaySettings,
  type CoordSystem,
} from '../types/coordSystem';
import { TAIPEI_CENTER } from '../config';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CoordDisplaySettings;
  onChange: (next: CoordDisplaySettings) => void;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';

/** 設定 → 坐標系：從右邊彈出的 Drawer（比照比例尺設定） */
export function CoordSettingsDrawer({ open, onOpenChange, settings, onChange }: Props) {
  const set = <K extends keyof CoordDisplaySettings>(k: K, v: CoordDisplaySettings[K]) =>
    onChange({ ...settings, [k]: v });
  const isLngLat = settings.system === 'wgs84';
  const [lng, lat] = TAIPEI_CENTER;
  const [a, b] = formatCoord(settings, lng, lat);

  const decimals = (label: string, key: 'lngLatDecimals' | 'xDecimals' | 'yDecimals', range: { min: number; max: number }) => (
    <div className="space-y-2">
      <Label className={SECTION_LABEL}>{label}</Label>
      <NumberStepper label={label} min={range.min} max={range.max} value={settings[key]} onChange={(v) => set(key, v)} />
    </div>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>坐標系</DrawerTitle>
            <DrawerDescription>滑鼠在圖面移動時，右下角顯示的坐標</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="coord-visible">顯示坐標</Label>
            <Switch id="coord-visible" checked={settings.visible} onCheckedChange={(v) => set('visible', v)} />
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>坐標系</Label>
            <RadioGroup value={settings.system} onValueChange={(v) => set('system', v as CoordSystem)}>
              {COORD_SYSTEMS.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <RadioGroupItem id={`coord-${s.id}`} value={s.id} />
                  <Label htmlFor={`coord-${s.id}`} className="font-normal">
                    {s.label}
                    <span className="text-muted-foreground text-xs">{s.hint}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {isLngLat ? (
            decimals('小數位數', 'lngLatDecimals', LNGLAT_DECIMALS_RANGE)
          ) : (
            <>
              {decimals('X 小數位數', 'xDecimals', XY_DECIMALS_RANGE)}
              {decimals('Y 小數位數', 'yDecimals', XY_DECIMALS_RANGE)}
            </>
          )}

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>預覽</Label>
            <div className="bg-muted flex flex-col gap-0.5 rounded-md px-2 py-1.5 font-mono text-xs tabular-nums">
              <span>{a}</span>
              <span>{b}</span>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
