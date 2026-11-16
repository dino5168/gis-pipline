import { MATERIALS, OTHER_MATERIAL, ALL_MATERIAL_CODES, OTHER_CODE } from '../map/pipeStyle';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

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
    <div className="space-y-1.5">
      {[...MATERIALS, OTHER_MATERIAL].map((m) => (
        <Label key={m.code} className="cursor-pointer gap-2 font-normal">
          <Checkbox checked={enabled.has(m.code)} onCheckedChange={(c) => toggle(m.code, c === true)} />
          <span className="h-1 w-[22px] flex-none rounded-sm" style={{ background: m.color }} />
          <span>
            {m.code !== OTHER_CODE && `${m.code} `}
            <span className="text-muted-foreground">{m.name}</span>
          </span>
        </Label>
      ))}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="xs" onClick={() => onChange(new Set(ALL_MATERIAL_CODES))}>
          全選
        </Button>
        <Button variant="outline" size="xs" onClick={() => onChange(new Set())}>
          全不選
        </Button>
      </div>
    </div>
  );
}
