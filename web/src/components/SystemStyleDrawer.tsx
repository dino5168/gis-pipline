import { Check, RotateCcw, X } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { isLightColor } from '../lib/theme';
import {
  DEFAULT_SYSTEM_STYLE,
  FONTS,
  TEXT_SIZES,
  THEMES,
  type FontId,
  type SystemStyle,
  type TextSize,
  type ThemeId,
} from '../types/systemStyle';
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
  settings: SystemStyle;
  onChange: (next: SystemStyle) => void;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';
const TILE =
  'group ring-border data-[state=checked]:ring-primary focus-visible:ring-ring relative flex cursor-pointer flex-col items-center gap-1 rounded-lg p-1.5 ring-1 outline-hidden data-[state=checked]:ring-2';

function TileCheck() {
  return (
    <RadioGroupPrimitive.Indicator className="bg-primary text-primary-foreground absolute top-1 right-1 flex size-4 items-center justify-center rounded-full">
      <Check className="size-3" />
    </RadioGroupPrimitive.Indicator>
  );
}

/** 主題預覽：背景色＋對比文字 */
function ThemeSwatch({ bg }: { bg: string }) {
  return (
    <div
      className="flex h-10 w-full items-center justify-center rounded-md text-sm ring-1 ring-black/20"
      style={{ backgroundColor: bg, color: isLightColor(bg) ? '#1b2530' : '#e6edf2' }}
    >
      Aa 文字
    </div>
  );
}

/** 設定 → 系統樣式：主題（背景色）、文字大小、粗體、字型（從右邊彈出的 Drawer） */
export function SystemStyleDrawer({ open, onOpenChange, settings: s, onChange }: Props) {
  const set = <K extends keyof SystemStyle>(k: K, v: SystemStyle[K]) => onChange({ ...s, [k]: v });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>系統樣式</DrawerTitle>
            <DrawerDescription>系統背景色與文字樣式（含地圖上的標籤）</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label className={SECTION_LABEL}>主題（背景色）</Label>
            <RadioGroupPrimitive.Root
              value={s.theme}
              onValueChange={(v) => set('theme', v as ThemeId)}
              className="grid grid-cols-2 gap-2"
              aria-label="主題"
            >
              {THEMES.map(({ id, label, bg }) => (
                <RadioGroupPrimitive.Item key={id} value={id} className={TILE}>
                  <ThemeSwatch bg={id === 'custom' ? s.customBg : bg} />
                  <span className="group-data-[state=checked]:text-primary text-xs">{label}</span>
                  <TileCheck />
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            {s.theme === 'custom' && (
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="sys-custom-bg">自訂背景色</Label>
                <input
                  id="sys-custom-bg"
                  type="color"
                  value={s.customBg}
                  onChange={(e) => set('customBg', e.target.value.toLowerCase())}
                  className="ring-border h-7 w-12 cursor-pointer rounded ring-1"
                />
                <span className="text-muted-foreground font-mono text-xs">{s.customBg}</span>
              </div>
            )}
            <p className="text-muted-foreground text-xs">選單、面板等顏色會依背景自動調配；背景偏亮時文字改為深色。</p>
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>文字大小</Label>
            <RadioGroupPrimitive.Root
              value={s.textSize}
              onValueChange={(v) => set('textSize', v as TextSize)}
              className="grid grid-cols-4 gap-2"
              aria-label="文字大小"
            >
              {TEXT_SIZES.map(({ id, label, scale }) => (
                <RadioGroupPrimitive.Item key={id} value={id} className={TILE}>
                  {/* 預覽用 px，不受目前根字級影響 */}
                  <span className="flex h-8 items-center" style={{ fontSize: `${Math.round(16 * scale)}px` }}>
                    字
                  </span>
                  <span className="group-data-[state=checked]:text-primary text-xs">
                    {label} {Math.round(scale * 100)}%
                  </span>
                  <TileCheck />
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="sys-bold">粗體</Label>
            <Switch id="sys-bold" checked={s.bold} onCheckedChange={(v) => set('bold', v)} />
          </div>

          <div className="space-y-2">
            <Label className={SECTION_LABEL}>字型</Label>
            <RadioGroup value={s.font} onValueChange={(v) => set('font', v as FontId)} className="gap-3">
              {FONTS.map(({ id, label, family }) => (
                <div key={id} className="flex items-center gap-2">
                  <RadioGroupItem id={`sys-font-${id}`} value={id} />
                  <Label htmlFor={`sys-font-${id}`} style={{ fontFamily: family }}>
                    {label}　臺北市公共管線 123
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {s.font === 'noto' && (
              <p className="text-muted-foreground text-xs">思源黑體由 Google Fonts 下載，需連網；電腦已安裝則直接使用。</p>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => onChange(DEFAULT_SYSTEM_STYLE)}>
            <RotateCcw />
            還原預設
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
