import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import SpatialSurface from "./SpatialSurface.jsx";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";

export default function CelestialTravelCard({ bodyId, destinationId, onTravel, onInspect, onClose }) {
  const body = CELESTIAL_BODIES[bodyId];
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, [bodyId]);
  if (!body) return null;
  const here = bodyId === destinationId;
  return <SpatialSurface as="aside" side="right" className="hud-panel hud-panel--right celestial-travel-card" aria-label="Selected celestial marker">
    <div className="hud-panel__header"><div><span className="eyebrow">SPATIAL SELECTION · {body.type.toUpperCase()}</span><h2>{body.name}</h2></div><button ref={closeRef} type="button" className="icon-button" aria-label="Close celestial selection" onClick={onClose}><X size={20} /></button></div>
    <div className="hud-panel__body"><p>{here ? "Your current destination." : "Marker selected. Travel when you are ready."}</p><p>Calculated position · approximate educational ephemeris.</p></div>
    <div className="hud-panel__footer inspector-actions"><button type="button" onClick={() => onTravel(bodyId)}>{here ? "RETURN TO LOCAL VIEW" : `TRAVEL TO ${body.name.toUpperCase()}`}</button>{here && bodyId !== "earth" && <button type="button" onClick={onInspect}>BODY FACTS</button>}</div>
  </SpatialSurface>;
}
