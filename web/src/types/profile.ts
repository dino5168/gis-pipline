// 剖面分析（/api/profile）的資料型別與斷面圖形計算
import type { PipeKindId } from './pipeKind';

export type LngLat = [number, number];

/** 剖面線與一條管線的交點（API 回傳） */
export interface ProfilePipe {
  layer: PipeKindId;
  gid: number;
  pipe_no: string | null;
  material: string | null;
  mgmt_unit: string | null;
  /** 原始管徑寬度／高度（單位見 size_unit） */
  dia_width: number | null;
  dia_height: number | null;
  size_unit: number | null;
  /** 共管條數 */
  n: number | null;
  /** 斷面寬（公尺） */
  w: number | null;
  /** 斷面高（公尺；null＝圓管） */
  h: number | null;
  /** 距剖面線起點（公尺） */
  dist: number;
  /** 管頂埋深（公尺，地表 = 0；null＝埋深缺值） */
  depth: number | null;
  /** 埋深異常、已截斷為上限 */
  clamped: boolean;
  /** 管線與剖面線平行重疊（取重疊段中點） */
  overlap: boolean;
  lng: number;
  lat: number;
}

export interface ProfileResult {
  /** 剖面線長度（公尺） */
  length: number;
  truncated: boolean;
  pipes: ProfilePipe[];
}

/** 沒有管徑時的預設（公尺），與 3D 相同 */
const DEFAULT_DIA = 0.1;

/** 斷面圖形：圓形（直徑 w）或矩形（寬 w × 高 h），單位公尺 */
export interface ProfileShape {
  rect: boolean;
  w: number;
  h: number;
}

/**
 * 斷面圖形（依 3D 的判斷）：有高度 → 矩形（寬×高是外包絡）；寬高比超過 10 倍視為高度填錯，當圓管；
 * 圓管多條共管時仍畫一個圓（直徑＝單條管徑），條數寫在標註上。
 */
export function profileShape(p: Pick<ProfilePipe, 'w' | 'h'>): ProfileShape {
  const w = p.w && p.w > 0 ? p.w : DEFAULT_DIA;
  if (p.h && p.h > 0 && p.h * 10 >= w && w * 10 >= p.h) return { rect: true, w, h: p.h };
  return { rect: false, w, h: w };
}

/** 管徑標註：圓管 Ø200mm、矩形 178×86mm（換算成 mm） */
export function formatSize(p: Pick<ProfilePipe, 'w' | 'h' | 'n'>): string {
  if (!p.w || p.w <= 0) return '管徑—';
  const s = profileShape(p);
  const mm = (m: number) => `${Math.round(m * 1000)}`;
  const size = s.rect ? `${mm(s.w)}×${mm(s.h)}mm` : `Ø${mm(s.w)}mm`;
  return p.n && p.n > 1 ? `${size}×${p.n}條` : size;
}
