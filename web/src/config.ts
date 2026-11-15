// 全域設定：服務位址、地圖初始範圍
const tilesBase = (import.meta.env.VITE_TILES_BASE as string | undefined) ?? 'http://127.0.0.1:3000';

/** 管線圖磚 TileJSON，可用網址參數 ?tiles=http://host:port/utl_pipe 覆寫 */
export const PIPE_TILEJSON =
  new URLSearchParams(location.search).get('tiles') ?? `${tilesBase}/utl_pipe`;

/** MVT 圖層名稱（= Martin 設定的資料表名稱） */
export const PIPE_SOURCE_LAYER = 'utl_pipe';

/** 與 martin.yaml 的 minzoom 一致 */
export const PIPE_MIN_ZOOM = 12;

export const TAIPEI_CENTER: [number, number] = [121.5654, 25.033];
export const PIPES_CENTER: [number, number] = [121.5654, 25.0412];

/** 資料範圍（台北市）[west, south, east, north] */
export const DATA_BOUNDS: [number, number, number, number] = [121.464, 24.966, 121.626, 25.152];

/** 3D 管線：縮放等級達此值才向 API 載入（太小範圍內管線過多） */
export const PIPE3D_MIN_ZOOM = 16;
/** 3D 管線：單次最多載入筆數（API 依離畫面中心距離排序） */
export const PIPE3D_LIMIT = 5000;
/** 3D 管線：埋深超過此值視為異常資料，以此值顯示（約 235 筆 > 30m） */
export const PIPE3D_MAX_DEPTH = 30;
/** 進入 3D 檢視時的地圖傾斜角度 */
export const PIPE3D_PITCH = 60;
