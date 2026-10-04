import { Orbit } from "lucide-react";
import { useEffect, useState } from "react";
import SpatialSurface from "./SpatialSurface.jsx";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { bodyCoverageNote, bodyFacts } from "../data/celestialFacts.js";
function Facts({ id, onOpen }) {
  const facts = bodyFacts(id);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused) return; const timer = window.setInterval(() => setIndex((value) => (value + 1) % facts.length), 10000); return () => window.clearInterval(timer); }, [facts.length, paused]);
  return <button className="body-fact" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onClick={onOpen}><small>{CELESTIAL_BODIES[id]?.name} · {index + 1}/{facts.length}</small><span>{facts[index]}</span>{bodyCoverageNote(id) && <small>{bodyCoverageNote(id)}</small>}<b>INSPECT ↗</b></button>;
}
export default function LiveDock({ bodyId = "earth", travel, detailState, viewTelemetry, trackedCount = 0, allOrbitsVisible, onToggleAllOrbits, feedAge, onOpenBody }) {
  return <SpatialSurface side="bottom" strength={2.8} className="live-dock live-telemetry-dock">
    {travel ? <div className="travel-status" role="status"><i /><strong>{CELESTIAL_BODIES[travel.from]?.name.toUpperCase()} → {CELESTIAL_BODIES[travel.to]?.name.toUpperCase()}</strong><span>Preparing destination · controls resume on arrival</span></div> : bodyId !== "earth" ? <><Facts key={bodyId} id={bodyId} onOpen={onOpenBody} />{detailState === "degraded" && <small>DETAIL RETRYING</small>}</> : <>
      <div className="telemetry-item"><span>CAMERA</span><strong>{Number.isFinite(viewTelemetry?.cameraAltitudeKm) ? `${Math.round(viewTelemetry.cameraAltitudeKm).toLocaleString()} km` : "—"}</strong></div><div className="dock-divider" />
      <div className="telemetry-item"><span>ORBITAL DATA AGE</span><strong>{Number.isFinite(feedAge) ? `${Math.floor(feedAge / 60)} min` : "Unavailable"}</strong></div><div className="dock-divider" />
      <button className={`dock-command ${allOrbitsVisible ? "is-active" : ""}`} onClick={onToggleAllOrbits} disabled={!trackedCount} aria-pressed={allOrbitsVisible}><Orbit size={18} />{allOrbitsVisible ? "HIDE ORBITS" : "SHOW ORBITS"}<b>{trackedCount}</b></button>
    </>}
  </SpatialSurface>;
}
