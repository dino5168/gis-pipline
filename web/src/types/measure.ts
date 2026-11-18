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

// ---- 量測樣式（設定 → 樣式）

/** 線條樣式 */
export type MeasureLineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';

export const MEASURE_LINE_STYLES: { id: MeasureLineStyle; label: string }[] = [
  { id: 'solid', label: '實線' },
  { id: 'dashed', label: '虛線' },
  { id: 'dotted', label: '點線' },
  { id: 'dash-dot', label: '點虛線' },
];

/** MapLibre line-dasharray（單位＝線寬倍數）；實線為 undefined。點線靠圓頭線端把長度 0 的段畫成圓點 */
export const MEASURE_DASHARRAY: Record<MeasureLineStyle, number[] | undefined> = {
  solid: undefined,
  dashed: [3, 2],
  dotted: [0, 2],
  'dash-dot': [4, 2, 0, 2],
};

/** 線條顏色預設色盤（量測畫在各種底圖上，選對比高的顏色） */
export const MEASURE_COLOR_PRESETS = ['#facc15', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#22d3ee', '#22c55e', '#ffffff', '#111827'];

export interface MeasureStyle {
  /** 線條、箭頭、頂點外框、填色的顏色（#rrggbb） */
  color: string;
  lineStyle: MeasureLineStyle;
  /** 線寬（px） */
  lineWidth: number;
  /** 面積／正方形／圓形的填色不透明度（0～1） */
  fillOpacity: number;
  /** 距離／面積的方向箭頭 */
  showArrows: boolean;
}

export const MEASURE_LINE_WIDTH_RANGE = { min: 1, max: 6, step: 0.5 } as const;

export const DEFAULT_MEASURE_STYLE: MeasureStyle = {
  color: '#facc15',
  lineStyle: 'dashed',
  lineWidth: 2.5,
  fillOpacity: 0.18,
  showArrows: true,
};

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
