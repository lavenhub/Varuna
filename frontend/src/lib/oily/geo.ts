export const EARTH_KM = 6371;

export function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Move from a point along a compass bearing (degrees from north) for a distance in km. */
export function destination(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): [number, number] {
  const dLat = (distanceKm * Math.cos(toRad(bearingDeg))) / 110.574;
  const dLon = (distanceKm * Math.sin(toRad(bearingDeg))) / (111.32 * Math.cos(toRad(lat)));
  return [lat + dLat, lon + dLon];
}

export function haversineKm(
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number],
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingBetween(
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number],
): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function compass(deg: number | null): string {
  if (deg === null || Number.isNaN(deg)) return "—";
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]!;
}

/** Circle polygon used for spill footprints and uncertainty rings. */
export function circle(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 48,
): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => destination(lat, lon, (i * 360) / steps, radiusKm));
}

export function fmtLatLon(lat: number, lon: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

/** Alias used across the incident routes. */
export const formatCoord = fmtLatLon;
