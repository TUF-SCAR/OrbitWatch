import { Cartesian3, JulianDate, Matrix3 } from "cesium";
import { ALL_CELESTIAL_IDS } from "../data/celestialBodies.js";
import { bodyPositionFixed, inertialToFixedMatrix } from "../data/solarSystemEphemeris.js";

// One resolved center per body/timestamp. Callbacks copy into Cesium's result;
// models, picking, labels and the local camera consume this same center.
export function createCanonicalPositions(resolve = bodyPositionFixed) {
  const cache = new Map(ALL_CELESTIAL_IDS.map((id) => [id, { time: null, center: new Cartesian3() }]));
  const frame = new Matrix3(), candidate = new Matrix3();
  let frameTime = null;
  return (id, time, result) => {
    const item = cache.get(id);
    if (!item) return undefined;
    if (resolve === bodyPositionFixed) {
      inertialToFixedMatrix(time, candidate);
      // ICRF data can finish loading while Time Explorer's clock is paused.
      // A timestamp alone is therefore insufficient to identify the frame.
      if (!frameTime || !JulianDate.equals(frameTime, time) || !Matrix3.equals(frame, candidate)) {
        for (const entry of cache.values()) entry.time = null;
        Matrix3.clone(candidate, frame);
        frameTime = JulianDate.clone(time, frameTime);
      }
    }
    if (!item.time || !JulianDate.equals(item.time, time)) {
      resolve(id, time, item.center);
      item.time = JulianDate.clone(time, item.time);
    }
    return result ? Cartesian3.clone(item.center, result) : item.center;
  };
}
