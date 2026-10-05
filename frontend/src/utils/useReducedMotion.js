import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./motionPreferences.js";
const subscribe = (notify) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => true);
}
