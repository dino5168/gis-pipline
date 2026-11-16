// /api/pipes3d 回傳的精簡管線資料
export interface Pipe3D {
  gid: number;
  /** 管線材料代碼 */
  mat: string | null;
  /** 管徑／寬度（公尺，已依尺寸單位換算）；有高度時為外包絡寬度，否則為單條管的直徑 */
  dia: number | null;
  /** 高度（公尺）；null 表示圓管（只有管徑） */
  h: number | null;
  /** 共管條數 */
  n: number | null;
  /** 起點埋設深度（公尺） */
  sd: number | null;
  /** 終點埋設深度（公尺） */
  ed: number | null;
  /** [經度, 緯度, Z] */
  coords: [number, number, number][];
}

export interface Pipes3DResponse {
  truncated: boolean;
  pipes: Pipe3D[];
}

/** 3D 高度依據 */
export type HeightMode = 'depth-top' | 'depth-center' | 'z';

export const HEIGHT_MODE_LABELS: Record<HeightMode, string> = {
  'depth-top': '埋深（量到管頂）',
  'depth-center': '埋深（量到管中心）',
  z: 'Z 值（絕對高程）',
};

/** 斷面顯示：外包絡（方形，單條圓管仍為圓柱）或依共管條數畫成多條小管 */
export type SectionMode = 'box' | 'conduits';

export const SECTION_MODE_LABELS: Record<SectionMode, string> = {
  box: '外包絡（方形斷面）',
  conduits: '多條小管（依共管條數）',
};

export interface Pipe3DOptions {
  heightMode: HeightMode;
  section: SectionMode;
  /** 垂直與管徑的放大倍率 */
  exaggeration: number;
}

/** 3D 載入狀態，顯示在控制面板 */
export type Pipe3DStatus =
  | { kind: 'off' }
  | { kind: 'zoom-in'; minZoom: number }
  /** phase：init＝載入 Cesium、fetch＝向 API 下載管線、build＝建立 3D 模型 */
  | { kind: 'loading'; phase: 'init' | 'fetch' | 'build' }
  | { kind: 'ready'; count: number; truncated: boolean }
  | { kind: 'error'; message: string };
