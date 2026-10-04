import { NATURAL_EARTH_LABELS } from "../data/naturalEarthLabels.js";
import { PLACE_LABELS } from "../data/placeLabels.js";

const nearCity = ([, lon, lat]) => NATURAL_EARTH_LABELS.some(([, x, y, kind]) => kind === "city" && Math.abs(x - lon) < 0.5 && Math.abs(y - lat) < 0.5);
export const OVERVIEW_LABELS = [
  ...NATURAL_EARTH_LABELS,
  ...PLACE_LABELS.filter((place) => !nearCity(place)).map((place) => [...place, 4]),
].sort((a, b) => (a[3] === b[3] ? a[4] - b[4] : a[3] === "country" ? -1 : 1));

export function labelAltitudeRange(kind, rank) {
  return kind === "country"
    ? [400_000, 20_000_000 / Math.pow(1.55, Math.max(0, rank - 1))]
    : [10_000, 7_000_000 / Math.pow(1.5, Math.max(0, rank - 1))];
}

// Priority-ordered screen rectangles. A hard cap bounds dense urban views.
export function selectLabelBoxes(candidates, width, height, limit = 45) {
  const accepted = [];
  for (const item of candidates) {
    if (![item.x, item.y, item.width].every(Number.isFinite)) continue;
    const left = item.x - item.width / 2 - 6, right = item.x + item.width / 2 + 6;
    const top = item.y - 12, bottom = item.y + 12;
    if (left < 0 || right > width || top < 0 || bottom > height) continue;
    if (accepted.some((b) => left < b.right && right > b.left && top < b.bottom && bottom > b.top)) continue;
    accepted.push({ ...item, left, right, top, bottom });
    if (accepted.length >= limit) break;
  }
  return accepted;
}
