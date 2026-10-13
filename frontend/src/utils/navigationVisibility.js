export const TIME_CELESTIAL_IDS = ["sun","mercury","venus","earth","mars","jupiter","saturn","uranus","neptune"];
export function celestialDestinationAllowed(mode,id) { return mode === "live" || (mode === "time" && TIME_CELESTIAL_IDS.includes(id)); }

export const PRODUCT_MODES = ["live", "time"];

// One policy for rendered controls, panel entry points and keyboard shortcuts.
export function navigationVisibility(mode, atEarth) {
  const live = mode === "live", valid = PRODUCT_MODES.includes(mode);
  return {
    modeRail: valid && atEarth,
    map: atEarth && live,
    camera: atEarth && valid,
    system: valid,
    explorer: atEarth && (live || mode === "time"),
    place: valid && atEarth,
  };
}
