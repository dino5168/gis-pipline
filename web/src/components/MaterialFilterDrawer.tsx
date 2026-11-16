import { X } from 'lucide-react';
import { MaterialLegend } from './MaterialLegend';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

/** 管線 → 材料篩選：從右邊彈出的 Drawer（比照設定的 Drawer） */
export function MaterialFilterDrawer({ open, onOpenChange, enabled, onChange }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>材料篩選</DrawerTitle>
            <DrawerDescription>2D、3D 只顯示勾選材料的管線（所有管線種類共用）；顏色為「依材料」著色時的圖例</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <MaterialLegend enabled={enabled} onChange={onChange} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
