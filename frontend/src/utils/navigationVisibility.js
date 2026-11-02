import {ALL_CELESTIAL_IDS} from '../data/celestialBodies.js';
export const TIME_CELESTIAL_IDS = Object.freeze([...ALL_CELESTIAL_IDS]);
export function celestialDestinationAllowed(mode,id) { return PRODUCT_MODES.includes(mode) && ALL_CELESTIAL_IDS.includes(id); }

export const PRODUCT_MODES = ["live", "time"];

// One policy for rendered controls, panel entry points and keyboard shortcuts.
export function navigationVisibility(mode, atEarth) {
  const live = mode === "live", valid = PRODUCT_MODES.includes(mode);
  return {
    modeRail: valid && atEarth,
    map: atEarth && valid,
    camera: atEarth && valid,
    system: valid,
    explorer: atEarth && (live || mode === "time"),
    place: valid && atEarth,
  };
}
