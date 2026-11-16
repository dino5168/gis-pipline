import { Check, X } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { ScaleBarGraphic } from './ScaleBar';
import {
  SCALE_BAR_MAX_WIDTH_RANGE,
  SCALE_BAR_STYLES,
  type ScaleBarSettings,
  type ScaleBarStyle,
  type ScaleBarUnit,
} from '../types/scaleBar';
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
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ScaleBarSettings;
  onChange: (next: ScaleBarSettings) => void;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';

/** 設定 → 比例尺：從右邊彈出的 Drawer */
export function ScaleBarSettingsDrawer({ open, onOpenChange, settings, onChange }: Props) {
  const set = <K extends keyof ScaleBarSettings>(k: K, v: ScaleBarSettings[K]) => onChange({ ...settings, [k]: v });
  const { min, max, step } = SCALE_BAR_MAX_WIDTH_RANGE;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>比例尺</DrawerTitle>
            <DrawerDescription>2D、3D 圖台左下角的比例尺</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="scale-visible">顯示比例尺</Label>
            <Switch id="scale-visible" checked={settings.visible} onCheckedChange={(v) => set('visible', v)} />
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>樣式</Label>
            <RadioGroupPrimitive.Root
              value={settings.style}
              onValueChange={(v) => set('style', v as ScaleBarStyle)}
              className="grid grid-cols-2 gap-2"
              aria-label="比例尺樣式"
            >
              {SCALE_BAR_STYLES.map(({ id, label }) => (
                <RadioGroupPrimitive.Item
                  key={id}
                  value={id}
                  className="group ring-border data-[state=checked]:ring-primary focus-visible:ring-ring relative flex cursor-pointer flex-col items-center gap-1 rounded-lg p-1.5 ring-1 outline-hidden data-[state=checked]:ring-2"
                >
                  <div className="flex h-10 w-full items-center justify-center rounded-md bg-white">
                    <ScaleBarGraphic style={id} width={96} labels={['0', '50', '100', '200']} />
                  </div>
                  <span className="group-data-[state=checked]:text-primary text-xs">{label}</span>
                  <RadioGroupPrimitive.Indicator className="bg-primary text-primary-foreground absolute top-1 right-1 flex size-4 items-center justify-center rounded-full">
                    <Check className="size-3" />
                  </RadioGroupPrimitive.Indicator>
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>單位</Label>
            <RadioGroup
              value={settings.unit}
              onValueChange={(v) => set('unit', v as ScaleBarUnit)}
              className="flex gap-4"
            >
              {(
                [
                  ['metric', '公制（m／km）'],
                  ['imperial', '英制（ft／mi）'],
                ] as const
              ).map(([v, text]) => (
                <div key={v} className="flex items-center gap-2">
                  <RadioGroupItem id={`scale-unit-${v}`} value={v} />
                  <Label htmlFor={`scale-unit-${v}`} className="font-normal">
                    {text}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>最大寬度 {settings.maxWidth}px</Label>
            <Slider min={min} max={max} step={step} value={[settings.maxWidth]} onValueChange={([v]) => set('maxWidth', v)} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
