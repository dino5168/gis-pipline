import { Ban } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import { BASEMAPS, BASEMAP_IDS, basemapThumbnail, thumbnailUrl, type BasemapId } from '../map/basemaps';
import { OVERLAYS, OVERLAY_IDS, type OverlayId } from '../map/overlays';
import { MEGA_TILE_CLASS, MegaSection, MegaTileBody, TileIcon, TileImages } from './MegaTile';
import { MenubarContent, MenubarMenu, MenubarSeparator, MenubarTrigger } from '@/components/ui/menubar';
import { Slider } from '@/components/ui/slider';

interface Props {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  overlays: ReadonlySet<OverlayId>;
  onOverlaysChange: (next: Set<OverlayId>) => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
}

/** 頂端選單「圖層」：Mega Menu，底圖（單選）＋疊加圖層（複選）縮圖方格，參考 Google 地圖圖層選擇 */
export function LayersMegaMenu(p: Props) {
  const toggleOverlay = (id: OverlayId, on: boolean) => {
    const next = new Set(p.overlays);
    if (on) next.add(id);
    else next.delete(id);
    p.onOverlaysChange(next);
  };
  // 疊加圖層縮圖：疊在目前底圖上（無底圖時用電子地圖）
  const baseThumb = basemapThumbnail(p.basemap === 'none' ? 'emap' : p.basemap);

  return (
    <MenubarMenu>
      <MenubarTrigger>圖層</MenubarTrigger>
      <MenubarContent className="w-[min(420px,calc(100vw-24px))] space-y-3 p-3">
        <MegaSection title="底圖（2D／3D 共用）">
          <MenubarPrimitive.RadioGroup
            value={p.basemap}
            onValueChange={(v) => p.onBasemapChange(v as BasemapId)}
            className="grid grid-cols-4 gap-2"
          >
            {BASEMAP_IDS.map((id) => {
              const src = basemapThumbnail(id);
              return (
                <MenubarPrimitive.RadioItem key={id} value={id} className={MEGA_TILE_CLASS}>
                  <MegaTileBody
                    label={BASEMAPS[id].name}
                    thumb={src ? <TileImages srcs={[src]} /> : <TileIcon><Ban /></TileIcon>}
                  />
                </MenubarPrimitive.RadioItem>
              );
            })}
          </MenubarPrimitive.RadioGroup>
        </MegaSection>

        <MenubarSeparator className="mx-0" />

        <MegaSection title="疊加圖層（可複選）">
          <div className="grid grid-cols-4 gap-2">
            {OVERLAY_IDS.map((id) => (
              <MenubarPrimitive.CheckboxItem
                key={id}
                checked={p.overlays.has(id)}
                onCheckedChange={(c) => toggleOverlay(id, c)}
                onSelect={(e) => e.preventDefault()} // 複選：點了不關閉選單
                title={OVERLAYS[id].note}
                className={MEGA_TILE_CLASS}
              >
                <MegaTileBody
                  label={OVERLAYS[id].name}
                  thumb={<TileImages srcs={[baseThumb, thumbnailUrl(OVERLAYS[id].source)]} />}
                />
              </MenubarPrimitive.CheckboxItem>
            ))}
          </div>
          {/* 選單會攔截方向鍵，滑桿的按鍵事件不往上傳 */}
          <div className="flex items-center gap-3 px-1.5 pt-2" onKeyDown={(e) => e.stopPropagation()}>
            <span className="text-muted-foreground flex-none text-xs">不透明度</span>
            <Slider
              className="min-w-0 flex-1"
              min={0.1}
              max={1}
              step={0.05}
              value={[p.overlayOpacity]}
              disabled={p.overlays.size === 0}
              onValueChange={([v]) => p.onOverlayOpacityChange(v)}
            />
            <span className="w-9 flex-none text-right text-xs">{Math.round(p.overlayOpacity * 100)}%</span>
          </div>
        </MegaSection>
      </MenubarContent>
    </MenubarMenu>
  );
}
