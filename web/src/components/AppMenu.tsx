import { Box, Columns2, Crosshair, Map as MapIcon, Ruler } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { VIEW_MODE_LABELS, type ViewMode } from '../types/view';
import type { BasemapId } from '../map/basemaps';
import type { OverlayId } from '../map/overlays';
import { LayersMegaMenu } from './LayersMegaMenu';
import { PipesMegaMenu } from './PipesMegaMenu';
import type { PipeColorMode, PipeKindId } from '../types/pipeKind';
import { MEGA_TILE_CLASS, MegaSection, MegaTileBody, TileIcon } from './MegaTile';
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from '@/components/ui/menubar';

const MODE_ICONS: Record<ViewMode, ReactNode> = {
  '2d': <MapIcon />,
  '3d': <Box />,
  split: <Columns2 />,
};

interface Props {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  overlays: ReadonlySet<OverlayId>;
  onOverlaysChange: (next: Set<OverlayId>) => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
  enabledKinds: ReadonlySet<PipeKindId>;
  onKindsChange: (next: Set<PipeKindId>) => void;
  colorMode: PipeColorMode;
  onColorModeChange: (m: PipeColorMode) => void;
  onOpenMaterialFilter: () => void;
  onOpenPipe3DSettings: () => void;
  onOpenScaleSettings: () => void;
  onOpenCoordSettings: () => void;
}

/** 頂端選單列（Mega Menu：縮圖方格） */
export function AppMenu({
  mode,
  onModeChange,
  onOpenScaleSettings,
  onOpenCoordSettings,
  enabledKinds,
  onKindsChange,
  colorMode,
  onColorModeChange,
  onOpenMaterialFilter,
  onOpenPipe3DSettings,
  ...layers
}: Props) {
  return (
    <header className="bg-background flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <h1 className="text-sm font-semibold whitespace-nowrap">台北市公共管線</h1>
      <Menubar className="border-none shadow-none">
        <MenubarMenu>
          <MenubarTrigger>圖台</MenubarTrigger>
          <MenubarContent className="p-3">
            <MegaSection title="圖台">
              <MenubarPrimitive.RadioGroup
                value={mode}
                onValueChange={(v) => onModeChange(v as ViewMode)}
                className="grid grid-cols-3 gap-2"
              >
                {(Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((m) => (
                  <MenubarPrimitive.RadioItem key={m} value={m} className={MEGA_TILE_CLASS}>
                    <MegaTileBody label={VIEW_MODE_LABELS[m]} thumb={<TileIcon>{MODE_ICONS[m]}</TileIcon>} />
                  </MenubarPrimitive.RadioItem>
                ))}
              </MenubarPrimitive.RadioGroup>
            </MegaSection>
          </MenubarContent>
        </MenubarMenu>
        <LayersMegaMenu {...layers} />
        <PipesMegaMenu
          enabledKinds={enabledKinds}
          onKindsChange={onKindsChange}
          colorMode={colorMode}
          onColorModeChange={onColorModeChange}
          onOpenMaterialFilter={onOpenMaterialFilter}
          onOpenPipe3DSettings={onOpenPipe3DSettings}
        />
        <MenubarMenu>
          <MenubarTrigger>設定</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onOpenScaleSettings}>
              <Ruler />
              比例尺
            </MenubarItem>
            <MenubarItem onSelect={onOpenCoordSettings}>
              <Crosshair />
              坐標系
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <span className="text-muted-foreground ml-auto hidden text-xs sm:inline">{VIEW_MODE_LABELS[mode]}</span>
    </header>
  );
}
