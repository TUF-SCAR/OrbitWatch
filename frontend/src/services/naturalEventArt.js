import { EVENT_CATEGORIES } from '../data/eventCategories.js';

// All glyphs share a 64 px coordinate system. The SVG remains vector art in
// report rows and is decoded at 192 px for the map's high-DPI canvas.
const faces = {
  cyclone: '<path fill="url(#body)" d="M52 14C50 31 38 41 28 37c-6-2-7-9-3-13 3-3 8-3 11 0C34 13 43 13 52 14ZM12 50c2-17 14-27 24-23 6 2 7 9 3 13-3 3-8 3-11 0 2 11-7 11-16 10Z"/><circle cx="32" cy="32" r="4" fill="#20175d" stroke="#e9e1ff" stroke-width="2"/>',
  earthquake: '<path fill="url(#body)" d="m14 29 18-8 18 8-3 15-15 7-15-7Z"/><path fill="#ffda9c" d="m14 29 18-8 18 8-18 9Z"/><path d="m22 26 8 5-3 4 8 4-3 12" fill="none" stroke="#542c4c" stroke-width="2.6" stroke-linecap="round"/><path d="m12 18 7-1 3-5 4 8 4-3 5 0m7 2 3-4 3 4 5 0" fill="none" stroke="#ffd6a3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  flood: '<path fill="#87f2ff" d="m20 28 12-12 13 12-4 2v10H23V30Z"/><path fill="#15506e" d="M29 30h6v10h-6z"/><path fill="url(#body)" d="M11 36c7-8 13-8 21-1s13 5 21-1v12c-7 8-14 8-22 2s-14-4-20 1Z"/><path d="M13 40c7-6 12-5 19 0s12 5 19 0" fill="none" stroke="#d4ffff" stroke-width="2.6" stroke-linecap="round"/>',
  wildfire: '<path fill="url(#body)" d="M33 9c-1 10 10 13 9 23 4-2 6-8 6-8 10 16 0 29-15 30-16 1-24-12-18-25 1 4 3 6 6 7-3-12 3-19 12-27Z"/><path fill="#ffe5a0" d="M33 30c-4 6-10 8-10 15 0 5 5 9 10 8 5 0 9-4 9-9 0-5-6-10-9-14Z"/><circle cx="47" cy="17" r="2.5" fill="#ffd092"/>',
  volcano: '<path fill="url(#body)" d="m12 48 14-24h13l13 24c-12 6-29 6-40 0Z"/><path fill="#ffd3a1" d="M26 24h13l4 8-7 1-3 9-4-13-7 1Z"/><path d="M32 20c-5-5 1-8 0-12m5 12c5-3 6-6 5-9" fill="none" stroke="#ffa46e" stroke-width="3" stroke-linecap="round"/><circle cx="23" cy="16" r="2.3" fill="#ffe0b3"/>',
  drought: '<circle cx="41" cy="20" r="10" fill="#ffcf79"/><path fill="url(#body)" d="M10 36c12-7 30-7 44 1l-5 11c-10 6-25 6-35 0Z"/><path d="m23 34 6 6-3 4 3 6m0-10 7-2 7 6-1 5" fill="none" stroke="#654333" stroke-width="2.4" stroke-linecap="round"/><path d="m38 9 2-4m10 5 4-2m-2 18 5 2" fill="none" stroke="#fff0aa" stroke-width="2" stroke-linecap="round"/>',
  landslide: '<path fill="url(#body)" d="M10 47V21l9-6 27 32c-11 6-27 7-36 0Z"/><path d="m13 24 7-4 20 25" fill="none" stroke="#ffe4ad" stroke-width="2.5" stroke-linecap="round"/><path fill="#ffd0a0" d="m40 22 6 1 1 7-5 3-5-5ZM49 35l5 4-2 5-6 1-2-6Z"/><circle cx="31" cy="21" r="2.2" fill="#f4eed7"/>',
  storm: '<path fill="url(#body)" d="M12 30c0-6 5-11 11-11 3-9 17-10 21 0 9 0 12 6 11 11-1 5-4 8-10 8H21c-6 0-9-3-9-8Z"/><path fill="#ffe39a" stroke="#af6545" stroke-width="1" d="m30 31-7 14h8l-3 11 15-19h-9l4-6Z"/><path d="m17 44-3 6m34-5-3 6" stroke="#81dcff" stroke-width="2.5" stroke-linecap="round"/>',
  snow_ice: '<path fill="url(#body)" d="M32 10 51 21v22L32 54 13 43V21Z"/><path d="M32 15v34m-15-25 30 16m0-16L17 40m10-18 5 5 5-5m-10 20 5-5 5 5" fill="none" stroke="#e7ffff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="32" r="4" fill="#fff"/>',
  dust: '<path fill="url(#body)" d="M11 29c-1-5 3-8 9-8 2-8 14-10 19-4 8-3 15 2 14 8 4 3 4 9-2 13H15c-6-1-8-6-4-9Z"/><path d="M14 32h26m-19 12h30m-32 6h19" fill="none" stroke="#ffe6bc" stroke-width="3" stroke-linecap="round"/><circle cx="49" cy="15" r="2" fill="#ffd69c"/>',
  temperature_extreme: '<path fill="url(#body)" d="M26 17a6 6 0 0 1 12 0v21a9 9 0 1 1-12 0Z"/><path d="M32 23v20" stroke="#fff0bf" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="45" r="4.5" fill="#fff0bf"/><path d="M41 20h7m-7 7h5m-5 7h7m-31-9-3 5 4 6" fill="none" stroke="#ffdbad" stroke-width="2.3" stroke-linecap="round"/>',
  water_color: '<path fill="url(#body)" d="M32 9c4 7 16 17 16 28a16 16 0 0 1-32 0c0-11 12-21 16-28Z"/><path d="M20 37c8-5 11 4 18 0l7-4v8c-4 9-20 9-24 2Z" fill="#8bf2bd"/><path d="M25 29c2-4 4-7 7-10" fill="none" stroke="#e3fff2" stroke-width="3" stroke-linecap="round"/>',
  other: '<path fill="url(#body)" d="M17 22c0-3 2-5 5-5h20c3 0 5 2 5 5v17c0 3-2 5-5 5h-9l-9 6v-6h-2c-3 0-5-2-5-5Z"/><path d="M24 26h16m-16 7h16m-16 6h9" fill="none" stroke="#f4fcff" stroke-width="2.5" stroke-linecap="round"/>',
};

const shadows = {
  cyclone:'#5440b8', earthquake:'#b15a38', flood:'#007ba7', wildfire:'#e1463b', volcano:'#9c4659',
  drought:'#a2703f', landslide:'#897455', storm:'#4460ac', snow_ice:'#347abb', dust:'#976542',
  temperature_extreme:'#c13e58', water_color:'#087b79', other:'#446982',
};
const icons = new Map();

export function eventIcon(category) {
  const key = Object.hasOwn(faces, category) ? category : 'other';
  if (!icons.has(key)) {
    const color = EVENT_CATEGORIES[key].color;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 64 64"><defs>
      <linearGradient id="body" x2=".35" y2="1"><stop stop-color="#fff" stop-opacity=".96"/><stop offset=".24" stop-color="${color}"/><stop offset="1" stop-color="${shadows[key]}"/></linearGradient>
      <radialGradient id="disc" cx=".33" cy=".22" r=".82"><stop stop-color="#253b58"/><stop offset="1" stop-color="#080e20"/></radialGradient>
      </defs><circle cx="32" cy="34" r="27.5" fill="#01040c" fill-opacity=".7"/>
      <circle cx="32" cy="32" r="26.1" fill="url(#disc)" stroke="#07101e" stroke-width="3.4"/>
      <circle cx="32" cy="32" r="25" fill="none" stroke="${color}" stroke-opacity=".82" stroke-width="1.4"/>
      <path d="M14 19a22 22 0 0 1 23-9" fill="none" stroke="#fff" stroke-opacity=".26" stroke-width="1.6" stroke-linecap="round"/>
      <g stroke="#14182a" stroke-width="1.4" stroke-opacity=".28" stroke-linejoin="round">${faces[key]}</g></svg>`;
    icons.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return icons.get(key);
}

const clusters = new Map();
export function clusterIcon(count, category) {
  const label = count > 99 ? '99+' : String(Math.max(2, Math.floor(count) || 2));
  const accent = EVENT_CATEGORIES[category]?.color || '#9bdbde';
  const key = `${label}:${accent}`;
  if (!clusters.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 48 48"><defs><linearGradient id="c" x2="0" y2="1"><stop stop-color="#214957"/><stop offset="1" stop-color="#0b1a2c"/></linearGradient></defs>
      <circle cx="24" cy="25" r="21" fill="#01050e" fill-opacity=".7"/>
      <circle cx="24" cy="23" r="18.5" fill="url(#c)" stroke="${accent}" stroke-width="1.5"/>
      <circle cx="24" cy="23" r="18" fill="${accent}" fill-opacity=".09"/>
      <path d="M10 19a15 15 0 0 1 18-10" fill="none" stroke="#e9ffff" stroke-opacity=".37"/>
      <text x="24" y="28" fill="#efffff" text-anchor="middle" font-size="14" font-weight="700" font-family="system-ui,sans-serif">${label}</text></svg>`;
    if (clusters.size >= 160) clusters.delete(clusters.keys().next().value);
    clusters.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return clusters.get(key);
}
