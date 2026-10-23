// Shared HUD hierarchy; scientific world positions are never interpolated.
import { uiNumber } from './uiConfig.js';
export const MOTION = Object.freeze({ get feedback(){return uiNumber('--ui-motion-feedback',160)/1000;}, get panel(){return uiNumber('--ui-motion-panel',280)/1000;}, selection: 0.18, marker: 0.42, label: 0.5, lod: 0.56, get travelUi(){return uiNumber('--ui-motion-travel',650)/1000;} });
export const HUD_EASE = [0.22, 1, 0.36, 1];
export function panelMotion(reduced = false) {
  return { initial: { opacity: 0, y: reduced ? 0 : 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduced ? 0 : 4 }, transition: { duration: reduced ? 0.04 : MOTION.panel, ease: HUD_EASE } };
}
