/** 比例尺樣式（參考 2-Tasks/1-UI/images/Ruler.png，由上而下） */
export type ScaleBarStyle =
  | 'alternating' // 黑白交錯塊
  | 'ticks-down' // 刻度朝下
  | 'ticks-up' // 刻度朝上
  | 'ticks-cross' // 刻度貫穿
  | 'hollow' // 空心分段
  | 'checker' // 雙排交錯塊
  | 'stepped' // 方波
  | 'double-line'; // 雙線刻度

export const SCALE_BAR_STYLES: { id: ScaleBarStyle; label: string }[] = [
  { id: 'alternating', label: '黑白交錯' },
  { id: 'ticks-down', label: '刻度朝下' },
  { id: 'ticks-up', label: '刻度朝上' },
  { id: 'ticks-cross', label: '刻度貫穿' },
  { id: 'hollow', label: '空心分段' },
  { id: 'checker', label: '雙排交錯' },
  { id: 'stepped', label: '方波' },
  { id: 'double-line', label: '雙線刻度' },
];

export type ScaleBarUnit = 'metric' | 'imperial';

export interface ScaleBarSettings {
  visible: boolean;
  style: ScaleBarStyle;
  unit: ScaleBarUnit;
  /** 比例尺最大寬度（px）；實際寬度會取整數距離，落在最大寬度的 1/2 以上 */
  maxWidth: number;
}

export const SCALE_BAR_MAX_WIDTH_RANGE = { min: 100, max: 300, step: 10 } as const;

export const DEFAULT_SCALE_BAR: ScaleBarSettings = {
  visible: true,
  style: 'alternating',
  unit: 'metric',
  maxWidth: 200,
};
