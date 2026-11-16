import { usePointerLngLat } from '../map/pointerCoord';
import { lngLatToTwd97, twd97ToTwd67 } from '../map/coordTransform';
import { COORD_SYSTEMS, type CoordDisplaySettings } from '../types/coordSystem';

/** 依設定把經緯度格式化成兩段文字（不加千分位） */
export function formatCoord(s: CoordDisplaySettings, lng: number, lat: number): [string, string] {
  if (s.system === 'wgs84') {
    return [`經度 ${lng.toFixed(s.lngLatDecimals)}°`, `緯度 ${lat.toFixed(s.lngLatDecimals)}°`];
  }
  let [x, y] = lngLatToTwd97(lng, lat);
  if (s.system === 'twd67') [x, y] = twd97ToTwd67(x, y);
  return [`X ${x.toFixed(s.xDecimals)}`, `Y ${y.toFixed(s.yDecimals)}`];
}

/** 滑鼠所在位置的坐標（地圖區右下角；滑鼠不在圖面上時隱藏） */
export function CoordinateDisplay({ settings }: { settings: CoordDisplaySettings }) {
  const p = usePointerLngLat();
  if (!p) return null;
  const [a, b] = formatCoord(settings, p.lng, p.lat);
  const label = COORD_SYSTEMS.find((s) => s.id === settings.system)?.label ?? '';
  return (
    <div className="bg-card/90 pointer-events-none absolute right-2 bottom-2 z-40 flex items-center gap-3 rounded-md px-2 py-1 font-mono text-xs tabular-nums shadow-sm backdrop-blur-sm">
      <span className="text-muted-foreground font-sans">{label}</span>
      <span>{a}</span>
      <span>{b}</span>
    </div>
  );
}
