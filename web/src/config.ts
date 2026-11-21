// 全域設定：服務位址、地圖初始範圍
const tilesBase = (import.meta.env.VITE_TILES_BASE as string | undefined) ?? 'http://127.0.0.1:3000';

/** Martin 圖磚服務位址，可用網址參數 ?tiles=http://host:port 覆寫；各管線種類的 TileJSON 為 `${TILES_BASE}/<資料表>` */
export const TILES_BASE = new URLSearchParams(location.search).get('tiles') ?? tilesBase;

export const TAIPEI_CENTER: [number, number] = [121.5654, 25.033];
export const PIPES_CENTER: [number, number] = [121.5654, 25.0412];

/** 資料範圍（台北市）[west, south, east, north] */
export const DATA_BOUNDS: [number, number, number, number] = [121.464, 24.966, 121.626, 25.152];

/** 3D 管線：2D 縮放等級達此值才向 API 載入（太小範圍內管線過多）；載入範圍＝2D 畫面範圍 */
export const PIPE3D_MIN_ZOOM = 17;
/** 3D 管線：單次最多載入筆數（API 依離畫面中心距離排序） */
export const PIPE3D_LIMIT = 5000;
/** 3D 管線：埋深超過此值視為異常資料，以此值顯示（約 235 筆 > 30m） */
export const PIPE3D_MAX_DEPTH = 30;
/** 3D 管線：埋深缺值（沒有或 ≤ 0）的管線改用這個顏色（埋深模式） */
export const PIPE3D_NO_DEPTH_COLOR = '#a9e34b';
/** 3D 管線：與 API 的 PIPES3D_MAX_SPAN 一致（度），載入範圍以畫面中心為準限制在此跨度內 */
export const PIPE3D_MAX_SPAN = 0.1;

/** Cesium 靜態檔（Workers、Assets…）的位址，由 vite.config.ts 複製到建置輸出的 cesium/ */
export const CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
/** 3D 地面預設不透明度（0～1，小於 1 才看得到地面下的管線） */
export const GROUND_OPACITY_DEFAULT = 0.5;
/** 2D 地圖最大傾斜角（與 3D 同步時用） */
export const MAP_MAX_PITCH = 85;

// ---- 門牌搜尋（/api/geocode）
/** 搜尋框輸入停止多久後才查詢（毫秒） */
export const GEOCODE_DEBOUNCE_MS = 200;
/** 下拉清單最多列幾筆 */
export const GEOCODE_LIMIT = 10;
/** 定位到門牌時的 2D 縮放等級（已經更近就不拉遠） */
export const GEOCODE_DOOR_ZOOM = 19;
/** 定位到路段時最多放大到此等級（路段只有一個門牌時範圍是一個點） */
export const GEOCODE_ROAD_MAX_ZOOM = 18;
/** 搜尋結果標記顏色（2D／3D 共用，與管線、量測、繪圖的顏色區隔） */
export const SEARCH_MARKER_COLOR = '#f59f00';
