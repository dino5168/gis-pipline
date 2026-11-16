/** 坐標顯示用的坐標系 */
export type CoordSystem = 'wgs84' | 'twd97' | 'twd67';

export const COORD_SYSTEMS: { id: CoordSystem; label: string; hint: string }[] = [
  { id: 'wgs84', label: '經緯度', hint: 'WGS84，度' },
  { id: 'twd97', label: 'TWD97', hint: 'TM2 121°，公尺' },
  { id: 'twd67', label: 'TWD67', hint: 'TM2 121°，公尺' },
];

export function isCoordSystem(v: unknown): v is CoordSystem {
  return COORD_SYSTEMS.some((s) => s.id === v);
}

/** 設定 → 坐標系 */
export interface CoordDisplaySettings {
  system: CoordSystem;
  /** 經緯度的小數位數 */
  lngLatDecimals: number;
  /** TWD97／TWD67 X 的小數位數 */
  xDecimals: number;
  /** TWD97／TWD67 Y 的小數位數 */
  yDecimals: number;
}

export const LNGLAT_DECIMALS_RANGE = { min: 0, max: 8 } as const;
export const XY_DECIMALS_RANGE = { min: 0, max: 6 } as const;

export const DEFAULT_COORD_DISPLAY: CoordDisplaySettings = {
  system: 'twd97',
  lngLatDecimals: 6,
  xDecimals: 4,
  yDecimals: 5,
};
