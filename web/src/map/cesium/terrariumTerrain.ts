// Cesium 地形：讀 Terrarium 編碼的 PNG 高程圖磚（例如 AWS Terrain Tiles）。
// Cesium 內建不支援 Terrarium，這裡用 CustomHeightmapTerrainProvider 自己解碼。
// 只由 CesiumScene.ts 匯入（隨 Cesium 動態載入）。
import { CustomHeightmapTerrainProvider, WebMercatorTilingScheme } from 'cesium';

/** 每張地形圖磚的取樣格數（Cesium 高度圖慣用 65×65） */
const GRID = 65;
/** 解碼後的高程圖磚快取張數（每張 256×256 Float32 約 256KB） */
const CACHE_SIZE = 64;

interface DecodedTile {
  size: number;
  /** 高程（公尺，海平面起算），列由北往南 */
  heights: Float32Array;
}

/** Terrarium：高程 = R×256 + G + B/256 − 32768 */
async function decodeTile(url: string): Promise<DecodedTile | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const size = bitmap.width;
  const canvas = new OffscreenCanvas(size, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = ctx.getImageData(0, 0, size, bitmap.height).data;
  const heights = new Float32Array(size * bitmap.height);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  return { size, heights };
}

/** 雙線性內插；(u, v) 為圖磚內 0～1 的位置（v 由北往南） */
function sample(t: DecodedTile, u: number, v: number): number {
  const n = t.size;
  const fx = Math.min(Math.max(u * n - 0.5, 0), n - 1);
  const fy = Math.min(Math.max(v * n - 0.5, 0), n - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
  const dx = fx - x0, dy = fy - y0;
  const h = t.heights;
  const top = h[y0 * n + x0] * (1 - dx) + h[y0 * n + x1] * dx;
  const bottom = h[y1 * n + x0] * (1 - dx) + h[y1 * n + x1] * dx;
  return top * (1 - dy) + bottom * dy;
}

/**
 * 建立 Terrarium 地形。超過 maxZoom 的層級從 maxZoom 的圖磚裁切內插（資料本身最細就到 maxZoom）。
 * 高度直接當成橢球高使用（未做大地起伏修正）；管線的 Z 值也是海平面起算、同樣直接當橢球高，兩者一致。
 */
export function createTerrariumTerrain(urlTemplate: string, maxZoom: number, credit: string) {
  const cache = new Map<string, Promise<DecodedTile | null>>();
  const load = (z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    let p = cache.get(key);
    if (p) {
      cache.delete(key); // 移到最後（LRU）
    } else {
      const url = urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      p = decodeTile(url).catch(() => null);
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    cache.set(key, p);
    return p;
  };

  return new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: new WebMercatorTilingScheme(),
    credit,
    callback: async (x, y, level) => {
      const d = Math.max(level - maxZoom, 0);
      const scale = 1 << d;
      const sx = x >> d, sy = y >> d;
      // 此圖磚在來源圖磚中的範圍（0～1）
      const u0 = (x - sx * scale) / scale, v0 = (y - sy * scale) / scale;
      const out = new Float32Array(GRID * GRID);
      const tile = await load(level - d, sx, sy);
      if (!tile) return out; // 讀不到（海面外、網路錯誤）就當高度 0
      for (let j = 0; j < GRID; j++) {
        const v = v0 + j / (GRID - 1) / scale;
        for (let i = 0; i < GRID; i++) out[j * GRID + i] = sample(tile, u0 + i / (GRID - 1) / scale, v);
      }
      return out;
    },
  });
}
