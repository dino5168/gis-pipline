/** 2D 量測模式：距離、面積（多邊形）、正方形、圓形 */
export type MeasureMode = 'distance' | 'area' | 'square' | 'circle';

/** 按鈕順序同此表 */
export const MEASURE_MODE_NAMES: Record<MeasureMode, string> = {
  distance: '距離',
  area: '面積',
  square: '正方形',
  circle: '圓形',
};

/** 兩點決定的圖形（第一點按下、第二點結束） */
export const isTwoPointMode = (m: MeasureMode): m is 'square' | 'circle' => m === 'square' || m === 'circle';
