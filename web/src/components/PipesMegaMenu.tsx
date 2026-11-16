import { Box, Filter } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import { MATERIALS, OTHER_MATERIAL } from '../map/pipeStyle';
import {
  PIPE_COLOR_MODE_LABELS,
  PIPE_KINDS,
  type PipeColorMode,
  type PipeKindId,
} from '../types/pipeKind';
import { MEGA_TILE_CLASS, MegaSection, MegaTileBody } from './MegaTile';
import {
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from '@/components/ui/menubar';

interface Props {
  enabledKinds: ReadonlySet<PipeKindId>;
  onKindsChange: (next: Set<PipeKindId>) => void;
  colorMode: PipeColorMode;
  onColorModeChange: (m: PipeColorMode) => void;
  onOpenMaterialFilter: () => void;
  onOpenPipe3DSettings: () => void;
}

/** 縮圖：幾條斜線，顏色依序取用（縮圖底色固定白色，比照地圖） */
function LinesThumb({ colors }: { colors: string[] }) {
  const n = colors.length;
  return (
    <svg viewBox="0 0 64 64" className="absolute inset-0 size-full bg-white" aria-hidden>
      {colors.map((c, i) => {
        const y = ((i + 1) * 64) / (n + 1);
        return <line key={i} x1={-4} y1={y + 14} x2={68} y2={y - 14} stroke={c} strokeWidth={n > 3 ? 4 : 6} strokeLinecap="round" />;
      })}
    </svg>
  );
}

const COLOR_MODE_THUMBS: Record<PipeColorMode, string[]> = {
  kind: PIPE_KINDS.map((k) => k.color),
  material: [...MATERIALS.slice(0, 4).map((m) => m.color), OTHER_MATERIAL.color],
};

/** 頂端選單「管線」：管線種類（複選）、著色方式，以及材料篩選、3D 顯示設定的 Drawer 入口 */
export function PipesMegaMenu(p: Props) {
  const toggleKind = (id: PipeKindId, on: boolean) => {
    const next = new Set(p.enabledKinds);
    if (on) next.add(id);
    else next.delete(id);
    p.onKindsChange(next);
  };

  return (
    <MenubarMenu>
      <MenubarTrigger>管線</MenubarTrigger>
      <MenubarContent className="w-[min(320px,calc(100vw-24px))] space-y-3 p-3">
        <MegaSection title="管線種類（可複選）">
          <div className="grid grid-cols-4 gap-2">
            {PIPE_KINDS.map((k) => (
              <MenubarPrimitive.CheckboxItem
                key={k.id}
                checked={p.enabledKinds.has(k.id)}
                onCheckedChange={(c) => toggleKind(k.id, c)}
                onSelect={(e) => e.preventDefault()} // 複選：點了不關閉選單
                title={`類別碼 ${k.classCode}；2D 縮放等級 ${k.minZoom} 以上顯示`}
                className={MEGA_TILE_CLASS}
              >
                <MegaTileBody label={k.name} thumb={<LinesThumb colors={[k.color]} />} />
              </MenubarPrimitive.CheckboxItem>
            ))}
          </div>
        </MegaSection>

        <MenubarSeparator className="mx-0" />

        <MegaSection title="著色">
          <MenubarPrimitive.RadioGroup
            value={p.colorMode}
            onValueChange={(v) => p.onColorModeChange(v as PipeColorMode)}
            className="grid grid-cols-4 gap-2"
          >
            {(Object.keys(PIPE_COLOR_MODE_LABELS) as PipeColorMode[]).map((m) => (
              <MenubarPrimitive.RadioItem
                key={m}
                value={m}
                onSelect={(e) => e.preventDefault()}
                className={MEGA_TILE_CLASS}
              >
                <MegaTileBody label={PIPE_COLOR_MODE_LABELS[m]} thumb={<LinesThumb colors={COLOR_MODE_THUMBS[m]} />} />
              </MenubarPrimitive.RadioItem>
            ))}
          </MenubarPrimitive.RadioGroup>
        </MegaSection>

        <MenubarSeparator className="mx-0" />

        <div>
          <MenubarItem onSelect={p.onOpenMaterialFilter}>
            <Filter />
            材料篩選…
          </MenubarItem>
          <MenubarItem onSelect={p.onOpenPipe3DSettings}>
            <Box />
            3D 顯示設定…
          </MenubarItem>
        </div>
      </MenubarContent>
    </MenubarMenu>
  );
}
