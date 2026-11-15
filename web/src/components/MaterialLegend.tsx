import { MATERIALS, OTHER_MATERIAL, ALL_MATERIAL_CODES, OTHER_CODE } from '../map/pipeStyle';

interface Props {
  enabled: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

/** 管線材料圖例＋篩選勾選 */
export function MaterialLegend({ enabled, onChange }: Props) {
  const toggle = (code: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(code);
    else next.delete(code);
    onChange(next);
  };

  return (
    <div>
      {[...MATERIALS, OTHER_MATERIAL].map((m) => (
        <label key={m.code} className="flex cursor-pointer items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={enabled.has(m.code)}
            onChange={(e) => toggle(m.code, e.target.checked)}
          />
          <span className="h-1 w-[22px] flex-none rounded-sm" style={{ background: m.color }} />
          <span>
            {m.code !== OTHER_CODE && `${m.code} `}
            <span className="text-muted">{m.name}</span>
          </span>
        </label>
      ))}
      <div className="mt-1 flex gap-2">
        <button className="btn" onClick={() => onChange(new Set(ALL_MATERIAL_CODES))}>
          全選
        </button>
        <button className="btn" onClick={() => onChange(new Set())}>
          全不選
        </button>
      </div>
    </div>
  );
}
