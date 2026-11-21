// 門牌搜尋結果在 2D 地圖上的標記（一次只有一個，再搜尋就移過去）。
import * as maplibregl from 'maplibre-gl';
import { GEOCODE_DOOR_ZOOM, GEOCODE_ROAD_MAX_ZOOM, SEARCH_MARKER_COLOR } from '../config';
import type { GeocodeResult } from '../types/geocode';

const markers = new WeakMap<maplibregl.Map, maplibregl.Marker>();

export function setSearchMarker(map: maplibregl.Map, r: GeocodeResult | null) {
  markers.get(map)?.remove();
  markers.delete(map);
  if (!r) return;
  // 彈出視窗用系統 token（index.css），文字顏色比照 PipeAttributeTable
  const label = document.createElement('div');
  label.className = 'text-[0.8125rem] font-semibold text-popover-foreground pr-1';
  label.textContent = r.label;
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 36 }).setDOMContent(label);
  const marker = new maplibregl.Marker({ color: SEARCH_MARKER_COLOR })
    .setLngLat([r.lng, r.lat])
    .setPopup(popup)
    .addTo(map);
  marker.getElement().title = r.label;
  marker.togglePopup();
  markers.set(map, marker);
}

/** 飛到搜尋結果：門牌放大到 GEOCODE_DOOR_ZOOM（已經更近就不拉遠），路段縮放到整段範圍 */
export function flyToSearchResult(map: maplibregl.Map, r: GeocodeResult) {
  if (r.kind === 'road' && r.bbox) {
    const [w, s, e, n] = r.bbox;
    map.fitBounds([w, s, e, n], { padding: 80, maxZoom: GEOCODE_ROAD_MAX_ZOOM, bearing: map.getBearing() });
  } else {
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(GEOCODE_DOOR_ZOOM, map.getZoom()) });
  }
}
