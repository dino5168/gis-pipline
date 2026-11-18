import type { HeightMode } from './pipe3d';
import type { PipeKindId } from './pipeKind';

/** 3D 量測模式：距離（斜距／水平／高差）、點位高度、面積（水平投影） */
export type Measure3DMode = 'distance' | 'height' | 'area';

/** 按鈕順序同此表 */
export const MEASURE3D_MODE_NAMES: Record<Measure3DMode, string> = {
  distance: '距離',
  height: '高度',
  area: '面積',
};

/** 量測點：高度為實際尺寸（已換算掉垂直放大倍率），基準依 3D 高度模式（埋深模式地表 = 0；Z 模式為絕對高程） */
export interface MeasurePoint3D {
  lng: number;
  lat: number;
  /** 公尺 */
  h: number;
  /** 點在管線表面或地面上 */
  on: 'pipe' | 'ground';
  pipe?: { layer: PipeKindId; gid: number };
}

/** 3D 量測結果（給畫面上的結果面板） */
export interface Measure3DResult {
  mode: Measure3DMode;
  heightMode: HeightMode;
  /** 已確定的點數 */
  pointCount: number;
  /** 還在加點中（尚未雙擊結束） */
  drawing: boolean;
  /** 距離：各段斜距總和、水平距離總和、高差（終點 − 起點），公尺 */
  slantM: number;
  horizontalM: number;
  dhM: number;
  /** 面積（水平投影，平方公尺）與周長 */
  areaM2: number;
  perimeterM: number;
  /** 高度：查詢的點 */
  point: MeasurePoint3D | null;
}
