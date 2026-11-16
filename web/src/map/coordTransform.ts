// 坐標轉換：WGS84 經緯度 → TWD97 TM2（121° 分帶）→ TWD67 TM2
// TWD67 用成大轉換公式（四參數近似，誤差約數公尺）：
// http://gis.thl.ncku.edu.tw/coordtrans/coordtrans.aspx（見 2-Tasks/1-UI/6-坐標系設定與坐標顯示.md）

// GRS80 橢球（TWD97；與 WGS84 差異可忽略）
const A_AXIS = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
// TM2 投影參數
const LON0 = (121 * Math.PI) / 180;
const K0 = 0.9999;
const FALSE_EASTING = 250000;

/** WGS84 經緯度（度）→ TWD97 TM2（公尺） */
export function lngLatToTwd97(lng: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const e4 = E2 * E2;
  const e6 = e4 * E2;

  const N = A_AXIS / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan;
  const C = EP2 * cos * cos;
  const A = (lam - LON0) * cos;
  const M =
    A_AXIS *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const x =
    FALSE_EASTING +
    K0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * A ** 5) / 120);
  const y =
    K0 *
    (M +
      N *
        tan *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * A ** 6) / 720));
  return [x, y];
}

// TWD97 ↔ TWD67 轉換參數
const P_A = 0.00001549;
const P_B = 0.000006521;

/** TWD97 TM2 → TWD67 TM2 */
export function twd97ToTwd67(x97: number, y97: number): [number, number] {
  return [x97 - 807.8 - P_A * x97 - P_B * y97, y97 + 248.6 - P_A * y97 - P_B * x97];
}

/** TWD67 TM2 → TWD97 TM2 */
export function twd67ToTwd97(x67: number, y67: number): [number, number] {
  return [x67 + 807.8 + P_A * x67 + P_B * y67, y67 - 248.6 + P_A * y67 + P_B * x67];
}
