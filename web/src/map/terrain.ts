import type { RasterDEMSourceSpecification } from 'maplibre-gl';

/**
 * 地形來源（2D 顯示為陰影地形 hillshade，3D 為地面起伏）。
 * 之後若自建國土測繪中心 DEM，在這裡加一筆即可。
 */
export type TerrainId = 'none' | 'aws';

interface TerrainDef {
  name: string;
  /** 選單上的補充說明 */
  note: string;
  /** Terrarium 編碼 PNG 圖磚（高程 = R×256 + G + B/256 − 32768，海平面起算） */
  source?: RasterDEMSourceSpecification & { tiles: string[]; maxzoom: number };
}

export const TERRAINS: Record<TerrainId, TerrainDef> = {
  none: { name: '無地形', note: '地面為平滑橢球面（高度 0）' },
  aws: {
    name: 'AWS 全球地形',
    note: 'AWS Open Data Terrain Tiles；台灣為 SRTM 30m 地表面（市區含建物、樹木高度）',
    source: {
      type: 'raster-dem',
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain Tiles © Mapzen、AWS Open Data（SRTM）',
      tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
    },
  },
};

export const TERRAIN_IDS = Object.keys(TERRAINS) as TerrainId[];
export const terrainSourceId = (id: TerrainId) => `dem-${id}`;
export const hillshadeLayerId = (id: TerrainId) => `hs-${id}`;
