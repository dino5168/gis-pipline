// 全域設定：服務位址、地圖初始範圍
const tilesBase = (import.meta.env.VITE_TILES_BASE as string | undefined) ?? 'http://127.0.0.1:3000';

/** Martin 圖磚服務位址，可用網址參數 ?tiles=http://host:port 覆寫；各管線種類的 TileJSON 為 `${TILES_BASE}/<資料表>` */
export const TILES_BASE = new URLSearchParams(location.search).get('tiles') ?? tilesBase;

export const TAIPEI_CENTER: [number, number] = [121.5654, 25.033];
export const PIPES_CENTER: [number, number] = [121.5654, 25.0412];

/** 資料範圍（台北市）[west, south, east, north] */
export const DATA_BOUNDS: [number, number, number, number] = [121.464, 24.966, 121.626, 25.152];

/** 3D 管線：相當於 2D 縮放等級達此值才向 API 載入（太小範圍內管線過多） */
export const PIPE3D_MIN_ZOOM = 16;
/** 3D 管線：單次最多載入筆數（API 依離畫面中心距離排序） */
export const PIPE3D_LIMIT = 5000;
/** 3D 管線：埋深超過此值視為異常資料，以此值顯示（約 235 筆 > 30m） */
export const PIPE3D_MAX_DEPTH = 30;
/** 3D 管線：與 API 的 PIPES3D_MAX_SPAN 一致（度），載入範圍以畫面中心為準限制在此跨度內 */
export const PIPE3D_MAX_SPAN = 0.1;
/** 3D 管線：載入範圍比畫面四周各多出畫面寬高的這個倍數，畫面還在範圍內就不重抓 */
export const PIPE3D_LOAD_MARGIN = 0.25;

/** Cesium 靜態檔（Workers、Assets…）的位址，由 vite.config.ts 複製到建置輸出的 cesium/ */
export const CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
/** 3D 地面預設不透明度（0～1，小於 1 才看得到地面下的管線） */
export const GROUND_OPACITY_DEFAULT = 0.5;
/** 2D 地圖最大傾斜角（與 3D 同步時用） */
export const MAP_MAX_PITCH = 85;
