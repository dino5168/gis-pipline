import type { RasterSourceSpecification } from 'maplibre-gl';

export type BasemapId = 'emap' | 'photo' | 'osm' | 'none';

interface BasemapDef {
  name: string;
  source?: RasterSourceSpecification;
}

const NLSC = '© 內政部國土測繪中心';

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  emap: {
    name: '臺灣通用電子地圖',
    source: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 20,
      attribution: NLSC,
      tiles: ['https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'],
    },
  },
  photo: {
    name: '正射影像',
    source: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 20,
      attribution: NLSC,
      tiles: ['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'],
    },
  },
  osm: {
    name: 'OpenStreetMap',
    source: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    },
  },
  none: { name: '無底圖' },
};

export const BASEMAP_IDS = Object.keys(BASEMAPS) as BasemapId[];
export const basemapLayerId = (id: BasemapId) => `bm-${id}`;

/** 選單縮圖用的固定圖磚（z16，台北車站附近） */
const THUMB_TILE = { z: 16, x: 54889, y: 28055 };

/** 把圖磚網址樣板換成縮圖用的那一張 */
export function thumbnailUrl(source: RasterSourceSpecification | undefined): string | undefined {
  const url = source?.tiles?.[0];
  if (!url) return undefined;
  const { z, x, y } = THUMB_TILE;
  return url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export const basemapThumbnail = (id: BasemapId) => thumbnailUrl(BASEMAPS[id].source);
