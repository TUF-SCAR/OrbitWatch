import { useEffect, useState } from "react";
import { Crosshair, UserRound, Wifi, WifiOff } from "lucide-react";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";

export default function TopHud({ mode, bodyId = "earth", apiState, currentUser, onProfileToggle }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return <header className="top-hud">
    <div className="brand-lockup"><div className="brand-lockup__title">ORBITWATCH</div><div className="brand-lockup__sub"><Crosshair size={13} /> SPATIAL ORBITAL INTELLIGENCE</div></div>
    <div className="hud-context"><strong>{CELESTIAL_BODIES[bodyId]?.name.toUpperCase()}</strong><small>{bodyId !== "earth" ? "REFERENCE MODEL · CALCULATED POSITION" : mode === "live" ? "LIVE MODE" : mode === "time" ? "TIME EXPLORER" : "DISASTER LAB"}</small></div>
    <div className="system-readout"><div className="hud-clocks"><span>UTC <b>{now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false })}</b></span><span>LOCAL <b>{now.toLocaleTimeString("en-GB", { hour12: false })}</b></span></div><span className={`system-readout__item is-${apiState}`}>{apiState === "online" ? <Wifi size={14} /> : <WifiOff size={14} />} ORBITAL FEED · {apiState === "online" ? "LIVE" : apiState.toUpperCase()}</span><button className="session-readout session-readout--button" type="button" onClick={onProfileToggle} aria-label="Open profile and settings"><UserRound size={16} /><strong>{currentUser?.username}</strong></button></div>
  </header>;
}
