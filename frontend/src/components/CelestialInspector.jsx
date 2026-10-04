import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Cartesian3, JulianDate } from "cesium";
import SpatialSurface from "./SpatialSurface.jsx";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { bodyRepresentation, bodyTextureSource, BODY_SOURCES } from "../data/celestialFacts.js";
import { bodyScienceSource, bodyAdditionalSources, CELESTIAL_NOTES } from "../data/celestialNotes.js";
import { AU_METERS, bodyOrbitalReference, bodyPositionFixed } from "../data/solarSystemEphemeris.js";
const number = (value, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
function PositionReadout({ bodyId, sceneTime }) {
  const [liveTime, setLiveTime] = useState(() => JulianDate.now());
  useEffect(() => { if (sceneTime) return; const timer = window.setInterval(() => setLiveTime(JulianDate.now()), 5000); return () => window.clearInterval(timer); }, [sceneTime]);
  const time = sceneTime ? JulianDate.fromDate(sceneTime) : liveTime;
  const position = bodyPositionFixed(bodyId, time);
  const parentId = CELESTIAL_BODIES[bodyId].parent;
  const parent = parentId && bodyPositionFixed(parentId, time);
  const distance = (point) => {
    const meters = Cartesian3.distance(position, point);
    return meters > AU_METERS / 10 ? `${number(meters / AU_METERS, 4)} AU` : `${number(meters / 1000, 0)} km`;
  };
  return <><h3>Calculated position</h3><p>At {JulianDate.toDate(time).toISOString().replace("T", " ").slice(0, 19)} UTC. Distances are center to center.</p>
    <dl className="celestial-measurements"><div><dt>From Earth</dt><dd>{distance(Cartesian3.ZERO)}</dd></div>{parent && <div><dt>From {CELESTIAL_BODIES[parentId].name}</dt><dd>{distance(parent)}</dd></div>}</dl>
    <p>Approximate educational ephemeris. Moon planes and small-body elements are simplified; encounters, terrain and body rotation are not precision simulations.</p></>;
}
export default function CelestialInspector({ bodyId, sceneTime, onClose, detailState }) {
  const body = CELESTIAL_BODIES[bodyId];
  if (!body) return null;
  const orbit = bodyOrbitalReference(bodyId);
  const axis = orbit && (orbit.semimajorAu ? `${number(orbit.semimajorAu, 4)} AU` : `${number(orbit.semimajorKm)} km`);
  const children = Object.values(CELESTIAL_BODIES).filter((item) => item.parent === bodyId);
  const rows = [
    ["Reference radius", `${number(body.radiusKm, 3)} km`], ["Reference diameter", `${number(body.radiusKm * 2, 3)} km`],
    ...(body.parent ? [["Parent body", CELESTIAL_BODIES[body.parent].name]] : []),
    ...(orbit ? [["Orbital period", `${number(orbit.periodDays, 3)} Earth days`], ["Semimajor axis", axis], ["Eccentricity", number(orbit.eccentricity, 4)], ["Inclination", `${number(Math.abs(orbit.inclination))}°`]] : []),
  ];
  return <SpatialSurface as="aside" side="right" className="inspector-panel celestial-inspector hud-panel hud-panel--right" aria-label="Celestial inspector">
    <div className="inspector-panel__head hud-panel__header"><div><span className="eyebrow">CELESTIAL OVERVIEW</span><h1>{body.name}</h1></div><button className="icon-button" onClick={onClose} aria-label="Close celestial inspector"><X size={20} /></button></div>
    <div className="hud-panel__body inspector-body">
    <div className="object-ident"><span>{body.type}</span><span>REFERENCE DATA</span></div>
    <a className="inspector-reference" href={bodyScienceSource(bodyId)} target="_blank" rel="noreferrer">Scientific reference ↗</a>
    <div className="inspector-scroll">
    <h3>Physical & orbital reference</h3><dl className="celestial-measurements">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>Rounded catalog values. Radius is a size reference for irregular bodies. Planetary elements use the J2000 reference epoch; moon reference planes are simplified.</p>
    {orbit && <p>The semimajor axis measures the size of the orbital ellipse. Eccentricity describes its departure from a circle; inclination describes the tilt from the model's reference plane.</p>}
    {children.length > 0 && <><h3>In this catalog</h3><p>{children.map((item) => item.name).join(", ")}. This is a selection of destinations, not a complete census of satellites.</p></>}
    <PositionReadout key={bodyId} bodyId={bodyId} sceneTime={sceneTime} />
    {CELESTIAL_NOTES[bodyId]?.length > 0 && <><h3>Science highlights</h3><p>{CELESTIAL_NOTES[bodyId].slice(0, 3).join(" ")}</p><p>Open the scientific reference above for the full exploration history and current research.</p></>}
    <h3>In this scene</h3><p>Positions are calculated from approximate orbital elements at the scene time. They are not a live spacecraft feed or precision navigation ephemeris.</p><p>{bodyRepresentation(bodyId)}</p>{detailState === "degraded" && <p className="inline-warning">Detailed model unavailable. A lightweight reference body remains visible while detail retries.</p>}
    <h3>Controls</h3><p>Drag to orbit. Scroll to zoom. Right-drag to pan around the body. Use System to visit another destination.</p><h3>Sources</h3>{[...bodyAdditionalSources(bodyId), ...BODY_SOURCES].map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></p>)}{bodyTextureSource(bodyId) && <a href={bodyTextureSource(bodyId)} target="_blank" rel="noreferrer">NASA texture source ↗</a>}</div>
    </div>
  </SpatialSurface>;
}
