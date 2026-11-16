// Cesium 地形：讀 Terrarium 編碼的 PNG 高程圖磚（例如 AWS Terrain Tiles）。
// Cesium 內建不支援 Terrarium，這裡用 CustomHeightmapTerrainProvider 自己解碼。
// 高度圖地形沒有頂點法向量，Cesium 不會依坡度打光（從上往下看和平面一樣），
// 所以另外用同一份高程算陰影地形（hillshade）當影像圖層疊上去。
// 只由 CesiumScene.ts 匯入（隨 Cesium 動態載入）。
import {
  CustomHeightmapTerrainProvider,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  type ImageryTypes,
} from 'cesium';

/** 每張地形圖磚的取樣格數（Cesium 高度圖慣用 65×65） */
const GRID = 65;
/** 解碼後的高程圖磚快取張數（每張 256×256 Float32 約 256KB） */
const CACHE_SIZE = 64;

interface DecodedTile {
  size: number;
  /** 高程（公尺，海平面起算），列由北往南 */
  heights: Float32Array;
}

/**
 * 低於此高程一律視為此值。Terrarium 含海底地形（台灣東部外海約 −6000m），乘上垂直放大後
 * 縮小時的粗圖磚會出現陸地／深海間的巨大落差（放射狀、尖刺）；這裡只需要陸地起伏。
 */
const MIN_HEIGHT = 0;

/** Terrarium：高程 = R×256 + G + B/256 − 32768 */
async function decodeTile(url: string): Promise<DecodedTile | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  // 先記下尺寸：ImageBitmap.close() 之後 width／height 會變成 0
  const size = bitmap.width, rows = bitmap.height;
  const canvas = new OffscreenCanvas(size, rows);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = ctx.getImageData(0, 0, size, rows).data;
  const heights = new Float32Array(size * rows);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = Math.max(px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768, MIN_HEIGHT);
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

/** Terrarium 圖磚來源：地形與陰影共用解碼快取 */
export interface TerrariumSource {
  url: string;
  maxZoom: number;
  credit: string;
  load: (z: number, x: number, y: number) => Promise<DecodedTile | null>;
}

export function createTerrariumSource(urlTemplate: string, maxZoom: number, credit: string): TerrariumSource {
  const cache = new Map<string, Promise<DecodedTile | null>>();
  const load = (z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    let p = cache.get(key);
    if (p) {
      cache.delete(key); // 移到最後（LRU）
    } else {
      const url = urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      p = decodeTile(url).catch((e: unknown) => {
        console.warn('[地形] 高程圖磚讀取失敗', url, e);
        return null;
      });
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    cache.set(key, p);
    return p;
  };
  return { url: urlTemplate, maxZoom, credit, load };
}

/**
 * 建立 Terrarium 地形。超過 maxZoom 的層級從 maxZoom 的圖磚裁切內插（資料本身最細就到 maxZoom）。
 * 高度直接當成橢球高使用（未做大地起伏修正）；管線的 Z 值也是海平面起算、同樣直接當橢球高，兩者一致。
 */
export function createTerrariumTerrain({ maxZoom, credit, load }: TerrariumSource) {
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

/** 光源：西北方（方位角 315°）、仰角 45°，與一般地圖的陰影地形慣例相同 */
const SUN_AZ = (315 * Math.PI) / 180;
const SUN_ALT = (45 * Math.PI) / 180;
const LIGHT = [Math.cos(SUN_ALT) * Math.sin(SUN_AZ), Math.cos(SUN_ALT) * Math.cos(SUN_AZ), Math.sin(SUN_ALT)];
/** 平地的亮度（以此為基準：較暗畫黑、較亮畫白） */
const FLAT = Math.sin(SUN_ALT);
const SHADOW_ALPHA = 0.75;
const HIGHLIGHT_ALPHA = 0.45;
const EARTH_CIRCUMFERENCE = 40075016.686;

function renderHillshade(t: DecodedTile, y: number, z: number): ImageryTypes {
  const n = t.size, h = t.heights;
  // 圖磚中心緯度的像素實際寬度（公尺）
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  const cell = (EARTH_CIRCUMFERENCE * Math.cos(lat)) / (n * 2 ** z);
  const canvas = new OffscreenCanvas(n, n);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const px = img.data;
  for (let j = 0; j < n; j++) {
    const jn = Math.max(j - 1, 0), js = Math.min(j + 1, n - 1);
    for (let i = 0; i < n; i++) {
      const iw = Math.max(i - 1, 0), ie = Math.min(i + 1, n - 1);
      const dzdx = (h[j * n + ie] - h[j * n + iw]) / ((ie - iw) * cell); // 往東
      const dzdy = (h[jn * n + i] - h[js * n + i]) / ((js - jn) * cell); // 往北（列由北往南）
      const shade = (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const k = (j * n + i) * 4;
      if (shade < FLAT) {
        px[k + 3] = (Math.min((FLAT - Math.max(shade, 0)) / FLAT, 1) * SHADOW_ALPHA * 255) | 0;
      } else {
        px[k] = px[k + 1] = px[k + 2] = 255;
        px[k + 3] = (((shade - FLAT) / (1 - FLAT)) * HIGHLIGHT_ALPHA * 255) | 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.transferToImageBitmap();
}

/** 陰影地形影像（透明底，暗處黑、亮處白），疊在底圖上；超過 maxZoom 由 Cesium 放大 */
class HillshadeImageryProvider extends UrlTemplateImageryProvider {
  private readonly src: TerrariumSource;
  constructor(src: TerrariumSource) {
    super({
      url: src.url, // 不會用到（requestImage 已覆寫），只是建構子必填
      tilingScheme: new WebMercatorTilingScheme(),
      maximumLevel: src.maxZoom,
      credit: src.credit,
      enablePickFeatures: false,
    });
    this.src = src;
  }

  override requestImage(x: number, y: number, level: number): Promise<ImageryTypes> | undefined {
    return this.src.load(level, x, y).then((t) => {
      if (!t) throw new Error(`地形圖磚讀取失敗 ${level}/${x}/${y}`);
      return renderHillshade(t, y, level);
    });
  }
}

export const createHillshadeImagery = (src: TerrariumSource) => new HillshadeImageryProvider(src);
