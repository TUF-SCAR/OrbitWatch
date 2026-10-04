// Read at the time of the action so a changed OS preference takes effect
// without reloading the scene. Manual camera gestures remain available.
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function cameraDuration(seconds) {
  return prefersReducedMotion() ? 0 : seconds;
}
