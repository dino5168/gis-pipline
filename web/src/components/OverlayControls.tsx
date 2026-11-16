import { OVERLAYS, OVERLAY_IDS, type OverlayId } from '../map/overlays';

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
    <div>
      {OVERLAY_IDS.map((id) => (
        <label key={id} className="flex cursor-pointer items-center gap-2 py-0.5">
          <input type="checkbox" checked={enabled.has(id)} onChange={(e) => toggle(id, e.target.checked)} />
          <span>
            {OVERLAYS[id].name} <span className="text-muted">（{OVERLAYS[id].note}）</span>
          </span>
        </label>
      ))}
      <label className="mt-1 flex items-center gap-2">
        <span className="text-muted flex-none">不透明度</span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0.1}
          max={1}
          step={0.05}
          value={opacity}
          disabled={enabled.size === 0}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
        />
        <span className="w-9 flex-none text-right">{Math.round(opacity * 100)}%</span>
      </label>
    </div>
  );
}
