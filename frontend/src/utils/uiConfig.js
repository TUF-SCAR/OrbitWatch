// CSS is the source of UI configuration; fallbacks support tests/SSR only.
export function uiNumber(name, fallback, node) {
  if (typeof document === "undefined") return fallback;
  const value = parseFloat(getComputedStyle(node || document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function uiEase() {
  if (typeof document === "undefined") return [0.22, 1, 0.36, 1];
  const values = getComputedStyle(document.documentElement).getPropertyValue("--ui-motion-ease").match(/-?\d*\.?\d+/g)?.map(Number);
  return values?.length === 4 ? values : [0.22, 1, 0.36, 1];
}
export function hudTimings() {
  return { loader: uiNumber("--ui-motion-loader", 240), interval: uiNumber("--ui-motion-reveal-interval", 175),
    morph: uiNumber("--ui-motion-morph", 520), ease: uiEase() };
}
