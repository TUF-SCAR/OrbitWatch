import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import ResponsivePanel from "./ResponsivePanel.jsx";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { usePhoneUI } from "../utils/usePhoneUI.js";

export default function CelestialTravelCard({ bodyId, destinationId, onTravel, onInspect, onClose }) {
  const body = CELESTIAL_BODIES[bodyId];
  const phone = usePhoneUI();
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [bodyId, phone]);
  if (!body) return null;
  const here = bodyId === destinationId;
  if (phone) return <aside className="phone-celestial-card" aria-label="Selected celestial marker">
    <div className="phone-celestial-card__name"><small>{body.type}</small><strong>{body.name}</strong></div>
    <button type="button" onClick={onInspect}>Details</button>
    <button type="button" className="phone-celestial-card__travel" onClick={() => onTravel(bodyId)} aria-label={here ? "Return to local view" : `Travel to ${body.name}`}>
      <ArrowUpRight size={17} aria-hidden="true" />{here ? "Local" : "Travel"}
    </button>
    <button ref={closeRef} type="button" aria-label="Close celestial selection" onClick={onClose}><X size={18} aria-hidden="true" /></button>
  </aside>;
  return <ResponsivePanel onDismiss={onClose} as="aside" side="right" className="hud-panel hud-panel--right celestial-travel-card" aria-label="Selected celestial marker">
    <div className="hud-panel__header"><div><span className="eyebrow">SPATIAL SELECTION · {body.type.toUpperCase()}</span><h2>{body.name}</h2></div><button ref={closeRef} type="button" className="icon-button" aria-label="Close celestial selection" onClick={onClose}><X size={20} /></button></div>
    <div className="hud-panel__body"><p>{here ? "Your current destination." : "Marker selected. Travel when you are ready."}</p><p>Calculated position · approximate educational ephemeris.</p></div>
    <div className="hud-panel__footer inspector-actions"><button type="button" onClick={() => onTravel(bodyId)}>{here ? "RETURN TO LOCAL VIEW" : `TRAVEL TO ${body.name.toUpperCase()}`}</button>{here && bodyId !== "earth" && <button type="button" onClick={onInspect}>BODY FACTS</button>}</div>
  </ResponsivePanel>;
}
