import { Check, RotateCcw, X } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from 'cn';
import {
  DEFAULT_MEASURE_STYLE,
  MEASURE_COLOR_PRESETS,
  MEASURE_DASHARRAY,
  MEASURE_LINE_STYLES,
  MEASURE_LINE_WIDTH_RANGE,
  type MeasureLineStyle,
  type MeasureStyle,
} from '../types/measure';
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
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measureStyle: MeasureStyle;
  onMeasureStyleChange: (next: MeasureStyle) => void;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';

/** 線條樣式預覽：SVG 的 dasharray 與 MapLibre 一樣以線寬為單位換算 */
function LinePreview({ lineStyle, color, width }: { lineStyle: MeasureLineStyle; color: string; width: number }) {
  const dash = MEASURE_DASHARRAY[lineStyle]?.map((v) => v * width).join(' ');
  return (
    <svg viewBox="0 0 96 12" className="h-3 w-full" aria-hidden>
      <line x1={width} y1={6} x2={96 - width} y2={6} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}

/** 設定 → 樣式：量測圖形的顏色、線條樣式等（從右邊彈出的 Drawer） */
export function StyleSettingsDrawer({ open, onOpenChange, measureStyle: s, onMeasureStyleChange }: Props) {
  const set = <K extends keyof MeasureStyle>(k: K, v: MeasureStyle[K]) => onMeasureStyleChange({ ...s, [k]: v });
  const { min, max, step } = MEASURE_LINE_WIDTH_RANGE;
  const isPreset = MEASURE_COLOR_PRESETS.includes(s.color.toLowerCase());

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>樣式</DrawerTitle>
            <DrawerDescription>2D 量測（距離、面積、正方形、圓形）的線條與填色</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>線條顏色</Label>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="線條顏色">
              {MEASURE_COLOR_PRESETS.map((c) => {
                const active = s.color.toLowerCase() === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={c}
                    title={c}
                    onClick={() => set('color', c)}
                    className={cn(
                      'ring-border focus-visible:ring-ring size-7 rounded-full ring-1 ring-offset-2 ring-offset-transparent outline-hidden',
                      active && 'ring-primary ring-2',
                    )}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
              {/* 自訂顏色：原生取色器 */}
              <label
                title="自訂顏色"
                className={cn(
                  'ring-border relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1',
                  !isPreset && 'ring-primary ring-2',
                )}
                style={{ background: isPreset ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : s.color }}
              >
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => set('color', e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="自訂顏色"
                />
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>線條樣式</Label>
            <RadioGroupPrimitive.Root
              value={s.lineStyle}
              onValueChange={(v) => set('lineStyle', v as MeasureLineStyle)}
              className="grid grid-cols-2 gap-2"
              aria-label="線條樣式"
            >
              {MEASURE_LINE_STYLES.map(({ id, label }) => (
                <RadioGroupPrimitive.Item
                  key={id}
                  value={id}
                  className="group ring-border data-[state=checked]:ring-primary focus-visible:ring-ring relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 ring-1 outline-hidden data-[state=checked]:ring-2"
                >
                  <div className="bg-muted flex h-8 w-full items-center rounded-md px-2">
                    <LinePreview lineStyle={id} color={s.color} width={s.lineWidth} />
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
            <Label className={SECTION_LABEL}>線寬 {s.lineWidth}px</Label>
            <Slider min={min} max={max} step={step} value={[s.lineWidth]} onValueChange={([v]) => set('lineWidth', v)} />
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>填色不透明度 {Math.round(s.fillOpacity * 100)}%</Label>
            <Slider
              min={0}
              max={60}
              step={2}
              value={[Math.round(s.fillOpacity * 100)]}
              onValueChange={([v]) => set('fillOpacity', v / 100)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="measure-arrows">顯示方向箭頭</Label>
            <Switch id="measure-arrows" checked={s.showArrows} onCheckedChange={(v) => set('showArrows', v)} />
          </div>

          <Button variant="outline" size="sm" onClick={() => onMeasureStyleChange(DEFAULT_MEASURE_STYLE)}>
            <RotateCcw />
            還原預設
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
