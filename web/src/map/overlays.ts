import type { RasterSourceSpecification } from 'maplibre-gl';

/** 疊加圖層（疊在底圖之上、管線之下的點陣圖磚） */
export type OverlayId = 'landPublic' | 'landSect';

interface OverlayDef {
  name: string;
  /** 面板上的補充說明 */
  note: string;
  source: RasterSourceSpecification;
}

const NLSC = '© 內政部國土測繪中心';
const nlscWmts = (layer: string) =>
  `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`;

// 完整地籍圖（含私有地每一宗地）不對外公開；國土測繪中心免費提供的只有下面兩種
export const OVERLAYS: Record<OverlayId, OverlayDef> = {
  landPublic: {
    name: '公有土地地籍圖',
    note: '只有公有地宗地與地號',
    source: { type: 'raster', tileSize: 256, maxzoom: 20, attribution: NLSC, tiles: [nlscWmts('LAND_OPENDATA')] },
  },
  landSect: {
    name: '段籍圖',
    note: '地段外框',
    source: { type: 'raster', tileSize: 256, maxzoom: 20, attribution: NLSC, tiles: [nlscWmts('LANDSECT')] },
  },
};

export const OVERLAY_IDS = Object.keys(OVERLAYS) as OverlayId[];
export const overlayLayerId = (id: OverlayId) => `ov-${id}`;
