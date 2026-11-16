import { OVERLAYS, OVERLAY_IDS, type OverlayId } from '../map/overlays';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface Props {
  enabled: ReadonlySet<OverlayId>;
  onChange: (next: Set<OverlayId>) => void;
  /** 0～1 */
  opacity: number;
  onOpacityChange: (v: number) => void;
}

/** 疊加圖層勾選＋透明度 */
export function OverlayControls({ enabled, onChange, opacity, onOpacityChange }: Props) {
  const toggle = (id: OverlayId, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      {OVERLAY_IDS.map((id) => (
        <Label key={id} className="cursor-pointer gap-2 font-normal">
          <Checkbox checked={enabled.has(id)} onCheckedChange={(c) => toggle(id, c === true)} />
          <span>
            {OVERLAYS[id].name} <span className="text-muted-foreground">（{OVERLAYS[id].note}）</span>
          </span>
        </Label>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <span className="text-muted-foreground flex-none text-xs">不透明度</span>
        <Slider
          className="min-w-0 flex-1"
          min={0.1}
          max={1}
          step={0.05}
          value={[opacity]}
          disabled={enabled.size === 0}
          onValueChange={([v]) => onOpacityChange(v)}
        />
        <span className="w-9 flex-none text-right text-xs">{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  );
}
