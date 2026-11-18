// 管線種類登錄表：一種管線一張資料表（= Martin 圖磚 source = API 的 layer 參數）。
// 新增管線種類：匯入資料表 → martin.yaml 發布 → API PIPE_LAYERS 白名單 → 在這裡登錄一筆。

export interface PipeKind {
  /** 資料表名稱（Martin source、MVT 圖層名稱、API layer 參數） */
  id: string;
  /** 顯示名稱 */
  name: string;
  /** 公共設施管線資料標準的類別碼 */
  classCode: string;
  /** 「依種類」著色時的顏色 */
  color: string;
  /** 2D 圖磚最小縮放等級，須與 martin.yaml 的 minzoom 一致 */
  minZoom: number;
}

/** 順序即選單順序；2D 後面的畫在上面 */
export const PIPE_KINDS = [
  { id: 'utl_pipe', name: '污水下水道管線', classCode: '8040101', color: '#2f9e44', minZoom: 12 },
  { id: 'utl_tel_pipe', name: '電信管線', classCode: '8010101', color: '#f08c00', minZoom: 15 },
  { id: 'utl_cable_duct', name: '纜線管路', classCode: '8080401', color: '#ae3ec9', minZoom: 12 },
  { id: 'utl_catv_pipe', name: '有線電視管線', classCode: '8010401', color: '#1c7ed6', minZoom: 12 },
  { id: 'utl_police_pipe', name: '警訊管線', classCode: '8010301', color: '#e03131', minZoom: 12 },
  // 8010601：電信小類 06，交換資料標準表 11 未列，名稱待確認
  { id: 'utl_tel06_pipe', name: '電信管線（小類 06）', classCode: '8010601', color: '#15aabf', minZoom: 12 },
] as const satisfies readonly PipeKind[];

export type PipeKindId = (typeof PIPE_KINDS)[number]['id'];

export const PIPE_KIND_IDS: PipeKindId[] = PIPE_KINDS.map((k) => k.id);

export const PIPE_KIND_BY_ID: Record<PipeKindId, PipeKind> = Object.fromEntries(
  PIPE_KINDS.map((k) => [k.id, k]),
) as Record<PipeKindId, PipeKind>;

export function isPipeKindId(v: unknown): v is PipeKindId {
  return typeof v === 'string' && v in PIPE_KIND_BY_ID;
}

/** 管線著色方式 */
export type PipeColorMode = 'kind' | 'material';

export const PIPE_COLOR_MODE_LABELS: Record<PipeColorMode, string> = {
  kind: '依種類',
  material: '依材料',
};
