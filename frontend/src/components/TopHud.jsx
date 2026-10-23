import { useEffect, useState } from "react";
import { Crosshair, UserRound, Wifi, WifiOff } from "lucide-react";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";

export default function TopHud({ mode, bodyId = "earth", apiState, sceneTime, currentUser, onProfileToggle }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return <header className="top-hud">
    <div className="brand-lockup" data-hud-footprint><div className="brand-lockup__title">ORBITWATCH</div><div className="brand-lockup__sub"><Crosshair size={13} /> SPATIAL ORBITAL INTELLIGENCE</div></div>
    <div className="hud-context" data-hud-footprint><strong>{CELESTIAL_BODIES[bodyId]?.name.toUpperCase()}</strong><small>{bodyId !== "earth" ? "REFERENCE MODEL · CALCULATED POSITION" : mode === "live" ? "LIVE MODE" : "TIME EXPLORER"}</small></div>
    <div className="system-readout" data-hud-footprint><div className="hud-clocks"><span>{mode === "time" ? "SCENE UTC" : "UTC"} <b>{(mode === "time" ? sceneTime : now).toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false })}</b></span><span>LOCAL <b>{(mode === "time" ? sceneTime : now).toLocaleTimeString("en-GB", { hour12: false })}</b></span></div><span className={`system-readout__item is-${mode === "time" ? "stale" : apiState}`}>{mode === "live" && apiState === "online" ? <Wifi size={14} /> : <WifiOff size={14} />} {mode === "time" ? "SATELLITE HISTORY · UNAVAILABLE" : <>ORBITAL FEED · {apiState === "online" ? "LIVE" : apiState.toUpperCase()}</>}</span><button className="session-readout session-readout--button" type="button" onClick={onProfileToggle} aria-label="Open profile and settings"><UserRound size={16} /><strong>{currentUser?.username}</strong></button></div>
  </header>;
}
