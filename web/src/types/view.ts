/** 圖台模式：只有 2D、只有 3D、2D 與 3D 並排 */
export type ViewMode = '2d' | '3d' | 'split';

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  '2d': '2D（MapLibre）',
  '3d': '3D（Cesium）',
  split: '2D,3D 並排',
};

/** 兩個圖台共用的視角（以 MapLibre 的定義：縮放等級、方位角、傾斜角皆為度） */
export interface CameraView {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  /** 0 = 垂直往下看 */
  pitch: number;
}
