// 滑鼠所在位置的經緯度（2D／3D 圖台寫入，坐標顯示元件讀取）。
// 用極小的外部 store 而不是 App state：滑鼠每動一下只重繪坐標顯示，不會重繪整個 App。
import { useSyncExternalStore } from 'react';

export type LngLat = { lng: number; lat: number } | null;

let current: LngLat = null;
const listeners = new Set<() => void>();

export function setPointerLngLat(v: LngLat) {
  if (v === current || (v && current && v.lng === current.lng && v.lat === current.lat)) return;
  current = v;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePointerLngLat(): LngLat {
  return useSyncExternalStore(subscribe, () => current);
}
