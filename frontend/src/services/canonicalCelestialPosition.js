import { Cartesian3, JulianDate } from "cesium";
import { ALL_CELESTIAL_IDS } from "../data/celestialBodies.js";
import { bodyPositionFixed } from "../data/solarSystemEphemeris.js";

// One resolved center per body/timestamp. Callbacks copy into Cesium's result;
// models, picking, labels and the local camera consume this same center.
export function createCanonicalPositions(resolve = bodyPositionFixed) {
  const cache = new Map(ALL_CELESTIAL_IDS.map((id) => [id, { time: null, center: new Cartesian3() }]));
  return (id, time, result) => {
    const item = cache.get(id);
    if (!item) return undefined;
    if (!item.time || !JulianDate.equals(item.time, time)) {
      resolve(id, time, item.center);
      item.time = JulianDate.clone(time, item.time);
    }
    return result ? Cartesian3.clone(item.center, result) : item.center;
  };
}
