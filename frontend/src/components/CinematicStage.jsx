import { useEffect, useState } from "react";
import "./CinematicStage.css";
const completed = new Set();
export default function CinematicStage({ active, side, loaderAnchor, zIndex = 20, cycle = 0, children }) {
  const key = `${cycle}:${loaderAnchor || side}`;
  const [readyKey, setReadyKey] = useState(() => completed.has(key) ? key : null);
  const ready = readyKey === key || completed.has(key);
  useEffect(() => {
    if (!active || completed.has(key)) return;
    const timer = window.setTimeout(() => { if (completed.size > 40) completed.clear(); completed.add(key); setReadyKey(key); }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750);
    return () => window.clearTimeout(timer);
  }, [active, key]);
  return <div className={`cinematic-stage cinematic-stage--${loaderAnchor} ${active ? "is-active" : ""} ${ready ? "is-ready" : ""}`} style={{ zIndex }} inert={!active || !ready} aria-hidden={!active}>
    <div className="cinematic-stage__content">{children}</div>
    {!ready && <div className="cinematic-stage__loader" aria-hidden="true"><i /><span>SYNC</span></div>}
  </div>;
}
