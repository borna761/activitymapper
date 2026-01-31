/**
 * Get pixel position from lat/lng for positioning overlays on the map.
 */
export function getPixelPosition(map, lat, lng) {
  if (!map) return { left: 0, top: 0 };
  const scale = Math.pow(2, map.getZoom());
  const proj = map.getProjection();
  if (!proj) return { left: 0, top: 0 };
  const bounds = map.getBounds();
  if (!bounds) return { left: 0, top: 0 };
  const nw = proj.fromLatLngToPoint(bounds.getNorthEast());
  const se = proj.fromLatLngToPoint(bounds.getSouthWest());
  const point = proj.fromLatLngToPoint(new window.google.maps.LatLng(lat, lng));
  const left = (point.x - se.x) * scale;
  const top = (point.y - nw.y) * scale;
  return { left, top };
}
