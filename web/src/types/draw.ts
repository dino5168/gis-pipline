/** 2D 繪圖：圖形（新增）與編輯兩組模式；一次只啟用一種（同 Leaflet-Geoman） */
export type DrawShapeMode = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle' | 'text';
export type DrawEditMode = 'select' | 'drag' | 'rotate' | 'cut' | 'delete';
export type DrawMode = DrawShapeMode | DrawEditMode;

/** 按鈕順序同此表 */
export const DRAW_SHAPE_MODE_NAMES: Record<DrawShapeMode, string> = {
  point: '點',
  linestring: '線',
  polygon: '多邊形',
  rectangle: '矩形',
  circle: '圓',
  text: '文字',
};

export const DRAW_EDIT_MODE_NAMES: Record<DrawEditMode, string> = {
  select: '選取／編輯頂點',
  drag: '拖曳',
  rotate: '旋轉',
  cut: '挖洞',
  delete: '刪除',
};

export const DRAW_MODE_NAMES: Record<DrawMode, string> = { ...DRAW_SHAPE_MODE_NAMES, ...DRAW_EDIT_MODE_NAMES };

/** 已實作的模式（逐步開放；未實作的按鈕顯示為停用） */
export const DRAW_IMPLEMENTED_MODES: ReadonlySet<DrawMode> = new Set<DrawMode>([
  'point',
  'linestring',
  'polygon',
  'rectangle',
  'circle',
  'text',
  'select',
  'drag',
  'rotate',
  'cut',
  'delete',
]);

/** 繪圖樣式（設定 → 樣式；套用到所有圖形與文字標註） */
export interface DrawStyle {
  /** 線、外框、填色、頂點、文字的顏色（#rrggbb） */
  color: string;
  /** 線寬（px） */
  lineWidth: number;
  /** 面的填色不透明度（0～1） */
  fillOpacity: number;
}

export const DRAW_LINE_WIDTH_RANGE = { min: 1, max: 6, step: 0.5 } as const;

export const DEFAULT_DRAW_STYLE: DrawStyle = {
  color: '#22d3ee',
  lineWidth: 2.5,
  fillOpacity: 0.2,
};

/** 文字標註的最大字數 */
export const DRAW_TEXT_MAX_LENGTH = 100;

/** 一個圖形的量測值（TWD97 平面坐標計算） */
export interface DrawMeasure {
  /** 圖形種類（Terra Draw 的模式名稱） */
  mode: DrawShapeMode;
  /** 還在繪製中（數值含跟著滑鼠的那一點） */
  drawing: boolean;
  /** 線：總長；面：周長（公尺） */
  lengthM: number;
  /** 面積（平方公尺）；點、線為 0 */
  areaM2: number;
  /** 矩形：寬、高（公尺） */
  widthM?: number;
  heightM?: number;
  /** 圓：半徑（公尺） */
  radiusM?: number;
  /** 挖過洞的多邊形：洞的數目（面積已扣掉洞、周長含洞的邊） */
  holes?: number;
  /** 點：經緯度 */
  lngLat?: [number, number];
}

/** 繪圖狀態（給 DrawControl 顯示） */
export interface DrawStatus {
  /** 圖上圖形數（不含繪製中的） */
  featureCount: number;
  /** 繪製中、選取中，或最後畫完的圖形的量測值 */
  measure: DrawMeasure | null;
  /** 有選取中的圖形 */
  selected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 自動儲存到瀏覽器失敗（例如儲存空間不足） */
  saveFailed: boolean;
}
