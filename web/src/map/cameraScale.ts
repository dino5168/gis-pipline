// 2D 縮放等級 ↔ 地面解析度（公尺／像素）換算，供 2D／3D 視角同步使用。
// MapLibre 的圖磚是 512px：縮放等級 z 時，赤道上每像素 = 地球周長 / (512 × 2^z)。
const EARTH_CIRCUMFERENCE = 40075016.686;

const cosLat = (lat: number) => Math.cos((lat * Math.PI) / 180);

export function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE * cosLat(lat)) / (512 * 2 ** zoom);
}

export function zoomFromMetersPerPixel(mpp: number, lat: number): number {
  return Math.log2((EARTH_CIRCUMFERENCE * cosLat(lat)) / (512 * mpp));
}
