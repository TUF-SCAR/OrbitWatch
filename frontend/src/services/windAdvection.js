import { WIND_STYLE } from './windConfig.js';

const RAD = Math.PI / 180;
const A = 6378137, E2 = 6.69437999014e-3;
export const wrapLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;

// No per-node allocations. Missing contributing corners invalidate the sample.
export function sampleWind(field, lon, lat, result = [0, 0]) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  const x = wrapLongitude(lon) + 180, y = 90 - lat;
  const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
  let u = 0, v = 0;
  for (let k = 0; k < 4; k++) {
    const east = k & 1, south = k >> 1;
    const w = (east ? dx : 1 - dx) * (south ? dy : 1 - dy);
    if (!w) continue;
    const i = Math.min(180, iy + south) * 360 + (ix + east) % 360;
    const a = field.u[i], b = field.v[i];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    u += a * w; v += b * w;
  }
  result[0] = u; result[1] = v; return result;
}
function derivative(field, lon, lat, result) {
  if (Math.abs(lat) > WIND_STYLE.maxLatitude || !sampleWind(field, lon, lat, result)) return false;
  const s = Math.sin(lat * RAD), d = 1 - E2 * s * s;
  result[0] /= A / Math.sqrt(d) * Math.cos(lat * RAD) * RAD;
  result[1] /= A * (1 - E2) / Math.pow(d, 1.5) * RAD;
  return true;
}
// Midpoint (RK2), WGS84 east/north metric. dt is modeled seconds, not scene time.
export function advectWind(field, lon, lat, dt, result = [0, 0], scratch = [0, 0]) {
  if (!derivative(field, lon, lat, scratch)) return null;
  const mx = lon + scratch[0] * dt * .5, my = lat + scratch[1] * dt * .5;
  if (!derivative(field, mx, my, scratch)) return null;
  const nextLat = lat + scratch[1] * dt;
  if (Math.abs(nextLat) > WIND_STYLE.maxLatitude) return null;
  result[0] = wrapLongitude(lon + scratch[0] * dt); result[1] = nextLat; return result;
}
export function windCartesian(lon, lat, result, offset = 0) {
  const p = lat * RAD, l = lon * RAD, s = Math.sin(p), c = Math.cos(p);
  const n = A / Math.sqrt(1 - E2 * s * s), h = WIND_STYLE.surfaceHeight;
  result[offset] = (n + h) * c * Math.cos(l);
  result[offset + 1] = (n + h) * c * Math.sin(l);
  result[offset + 2] = (n * (1 - E2) + h) * s;
}
