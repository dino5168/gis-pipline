import { Check } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { MenubarLabel } from '@/components/ui/menubar';

/** Mega Menu 區段標題 */
export function MegaSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <MenubarLabel className="text-muted-foreground px-0 pt-0 pb-2 text-xs">{title}</MenubarLabel>
      {children}
    </section>
  );
}

/** 縮圖方塊的外觀（放在 RadioItem／CheckboxItem 裡；父層需有 group class 與 data-state） */
export function MegaTileBody({ thumb, label }: { thumb: ReactNode; label: string }) {
  return (
    <>
      <div className="bg-muted ring-border group-data-[state=checked]:ring-primary relative size-16 overflow-hidden rounded-lg ring-1 group-data-[state=checked]:ring-2">
        {thumb}
        <MenubarPrimitive.ItemIndicator className="bg-primary text-primary-foreground absolute top-1 right-1 flex size-4 items-center justify-center rounded-full">
          <Check className="size-3" />
        </MenubarPrimitive.ItemIndicator>
      </div>
      <span className="group-data-[state=checked]:text-primary text-center text-xs leading-tight">{label}</span>
    </>
  );
}

/** 縮圖方塊項目共用 class */
export const MEGA_TILE_CLASS =
  'group flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1.5 outline-hidden select-none focus:bg-accent';

/** 縮圖：疊放多張圖片（底圖＋疊加圖層） */
export function TileImages({ srcs }: { srcs: (string | undefined)[] }) {
  return (
    <>
      {srcs.map(
        (src, i) =>
          src && (
            <img key={i} src={src} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover" />
          ),
      )}
    </>
  );
}

/** 縮圖：置中圖示 */
export function TileIcon({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground absolute inset-0 flex items-center justify-center [&_svg]:size-7">{children}</div>
  );
}
