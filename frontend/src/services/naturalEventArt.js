import { EVENT_CATEGORIES } from '../data/eventCategories.js';

// Compact instruments, drawn in a common coordinate system. Keep the shape
// readable through the tinted glass and at the smallest map marker size.
const glyphs = {
  cyclone: '<path d="M49 14c-2 9-7 15-16 18m-18 18c2-9 7-15 16-18M17 18c14-3 27 6 27 16 0 6-4 11-9 11M47 46c-14 3-27-6-27-16 0-6 4-11 9-11"/><circle cx="32" cy="32" r="3" fill="currentColor" stroke="none"/>',
  earthquake: '<path d="M13 33h9l4-8 5 19 5-25 4 14h11M17 48h30"/><path d="M18 19h8m18 0h4" opacity=".45"/>',
  flood: '<path d="M13 34c6-5 11-5 17 0s12 5 21-1M13 44c6-5 11-5 17 0s12 5 21-1M32 27V15m-6 6 6-6 6 6"/>',
  wildfire: '<path d="M34 13c-2 8 9 13 10 21 2-1 4-4 4-6 6 11 0 22-14 22-13 0-19-10-15-19l5 6c-1-10 4-16 10-24Z"/><path d="M33 35c2 5 8 8 5 14m-9 0c-3-4 0-8 4-14" opacity=".7"/>',
  volcano: '<path d="m12 48 14-22h11l15 22H12Zm11-17 7 3 2 7 4-10 5 1M30 20l-3-6m9 7 3-9"/><circle cx="33" cy="13" r="1.4" fill="currentColor" stroke="none"/>',
  drought: '<path d="M14 38h36m-30 8h24M25 38l6 5-2 5m11-10-4 5 2 5M24 31a8 8 0 1 1 16 0m-8-17v3m-12 2 2 3m22-3-2 3"/>',
  landslide: '<path d="m13 18 11 2 22 28H13m29-17 4-1 3 4-3 4-5-3Zm-9-12 5 2-1 5-5 1-2-4Z"/><path d="m16 26 5 1 12 17" opacity=".48"/>',
  storm: '<path d="M22 37h-1a8 8 0 0 1-1-16 12 12 0 0 1 22-1 9 9 0 0 1-1 17h-1m-8-6-7 12h8l-3 9 12-15h-9"/>',
  snow_ice: '<path d="M32 13v38m-16-29 32 20m0-20L16 42m11-24 5 5 5-5m-10 28 5-5 5 5M17 27l7-1-2-7m25 18-7 1 2 7m5-18-7-1 2-7M17 37l7 1-2 7"/>',
  dust: '<path d="M14 25h23c7 0 7-9 1-9-3 0-4 2-4 3m-10 15h22m-29 9h20c5 0 5 6 0 6"/><path d="M16 34h2m28-9h4m-7 18h4" opacity=".56"/>',
  temperature_extreme: '<path d="M25 19a6 6 0 0 1 12 0v19a9 9 0 1 1-12 0Zm6 5v19m12-23h5m-5 8h5m-5 8h5"/><circle cx="31" cy="44" r="3" fill="currentColor" stroke="none"/>',
  water_color: '<path d="M32 13c6 9 14 16 14 23a14 14 0 1 1-28 0c0-7 8-14 14-23Zm-10 23c8-5 11 5 20 0m-17 6h14"/>',
  other: '<circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="3" fill="currentColor" stroke="none"/><path d="M32 13v6m0 26v6M13 32h6m26 0h6"/>',
};
const icons = new Map(), clusters = new Map();
const encode = svg => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export function eventIcon(category) {
  const key = Object.hasOwn(glyphs, category) ? category : 'other';
  if (!icons.has(key)) {
    const accent = EVENT_CATEGORIES[key].color;
    icons.set(key, encode(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 64 64">
      <defs><linearGradient id="glass" x2="0" y2="1"><stop stop-color="#20384e"/><stop offset="1" stop-color="#081221"/></linearGradient></defs>
      <path d="M20 7h24l13 13v24L44 57H20L7 44V20Z" fill="#050b16" stroke="#060c16" stroke-width="4"/>
      <path d="M20 7h24l13 13v24L44 57H20L7 44V20Z" fill="url(#glass)" stroke="${accent}" stroke-opacity=".76" stroke-width="1.5"/>
      <path d="M20 7h24M7 20v8m50 8v8L44 57" fill="none" stroke="#e3f5ff" stroke-opacity=".32" stroke-width="1.4"/>
      <g color="${accent}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyphs[key]}</g></svg>`));
  }
  return icons.get(key);
}

export function clusterIcon(count, category) {
  const label = count > 99 ? '99+' : String(Math.max(2, Math.floor(count) || 2));
  const accent = EVENT_CATEGORIES[category]?.color || '#9bdbde';
  const key = `${label}:${accent}`;
  if (!clusters.has(key)) {
    if (clusters.size >= 160) clusters.delete(clusters.keys().next().value);
    clusters.set(key, encode(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 48 48">
      <path d="M13 13h22l9 8v14l-9 8H13l-9-8V21Z" fill="#091422" stroke="${accent}" stroke-opacity=".45"/>
      <path d="M13 6h22l9 8v14l-9 8H13l-9-8V14Z" fill="#102336" stroke="${accent}" stroke-width="1.5"/>
      <text x="24" y="26" fill="#effaff" text-anchor="middle" font-size="15" font-weight="650" font-family="system-ui,sans-serif">${label}</text></svg>`));
  }
  return clusters.get(key);
}
