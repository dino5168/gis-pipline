// /api/pipes3d 回傳的精簡管線資料
export interface Pipe3D {
  gid: number;
  /** 管線材料代碼 */
  mat: string | null;
  /** 管徑（公尺，已依尺寸單位換算） */
  dia: number | null;
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

export interface Pipe3DOptions {
  heightMode: HeightMode;
  /** 垂直與管徑的放大倍率 */
  exaggeration: number;
}

/** 3D 載入狀態，顯示在控制面板 */
export type Pipe3DStatus =
  | { kind: 'off' }
  | { kind: 'zoom-in'; minZoom: number }
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; truncated: boolean }
  | { kind: 'error'; message: string };
