const MODEL_ROOT = "/models/satellites";
const GENERATED_ROOT = `${MODEL_ROOT}/generated`;

const GENERATED_IDS = new Set([20580, 25544, 25867, 25989, 25994, 26407, 27424, 27663, 28190, 28376, 28474, 28485, 28874, 29479, 29486, 29601, 32260, 32275, 32276, 32384, 32393, 32395, 32711, 33053, 35752, 36111, 36112, 36402, 36585, 37867, 37868, 37869, 38358, 38833, 39084, 39166, 39533, 39634, 39741, 40105, 40294, 40534, 40544, 40545, 40697, 40730, 40732, 40890, 41174, 41175, 41335, 41549, 41550, 41752, 41836, 41859, 41860, 41861, 41862, 41866, 41882, 42063, 43001, 43002, 43010, 43013, 43055, 43056, 43057, 43058, 43107, 43108, 43207, 43208, 43226, 43245, 43246, 43435, 43437, 43564, 43565, 43566, 43567, 43581, 43582, 43613, 43689, 43823, 44387, 48274, 49008, 49260, 49809, 51850, 54234, 54743, 54754, 58990, 59051, 60133]);

const CATEGORY_FALLBACK = {
  Stations: `${MODEL_ROOT}/iss.glb`,
  Observatories: `${MODEL_ROOT}/observatory.glb`,
  "Earth Observation": `${MODEL_ROOT}/earth_observation.glb`,
  Weather: `${MODEL_ROOT}/weather.glb`,
  Navigation: `${MODEL_ROOT}/navigation.glb`,
};

export function getSatelliteModelUrl(object) {
  const noradId = Number(object?.noradId);

  if (Number.isFinite(noradId) && GENERATED_IDS.has(noradId)) {
    return `${GENERATED_ROOT}/${noradId}.glb`;
  }

  return (
    CATEGORY_FALLBACK[object?.category] ||
    `${MODEL_ROOT}/earth_observation.glb`
  );
}

export function getSatelliteModelKind(object) {
  return String(
    object?.name || object?.category || "SATELLITE"
  ).toUpperCase();
}
