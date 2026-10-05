// Shared HUD hierarchy; scientific world positions are never interpolated.
export const MOTION = Object.freeze({ feedback: 0.16, panel: 0.28, selection: 0.18, marker: 0.42, label: 0.5, lod: 0.56, travelUi: 0.65 });
export const HUD_EASE = [0.22, 1, 0.36, 1];
export function panelMotion(reduced = false) {
  return { initial: { opacity: 0, y: reduced ? 0 : 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduced ? 0 : 4 }, transition: { duration: reduced ? 0.04 : MOTION.panel, ease: HUD_EASE } };
}
