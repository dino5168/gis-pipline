import { Box, Columns2, Map as MapIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { VIEW_MODE_LABELS, type ViewMode } from '../types/view';
import {
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarTrigger,
} from '@/components/ui/menubar';

const MODE_ICONS: Record<ViewMode, ReactNode> = {
  '2d': <MapIcon />,
  '3d': <Box />,
  split: <Columns2 />,
};

interface Props {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
}

/** 頂端選單列 */
export function AppMenu({ mode, onModeChange }: Props) {
  return (
    <header className="bg-background flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <h1 className="text-sm font-semibold whitespace-nowrap">台北市公共管線</h1>
      <Menubar className="border-none shadow-none">
        <MenubarMenu>
          <MenubarTrigger>圖台</MenubarTrigger>
          <MenubarContent>
            <MenubarRadioGroup value={mode} onValueChange={(v) => onModeChange(v as ViewMode)}>
              {(Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((m) => (
                <MenubarRadioItem key={m} value={m}>
                  {MODE_ICONS[m]}
                  {VIEW_MODE_LABELS[m]}
                </MenubarRadioItem>
              ))}
            </MenubarRadioGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <span className="text-muted-foreground ml-auto hidden text-xs sm:inline">{VIEW_MODE_LABELS[mode]}</span>
    </header>
  );
}
