import { useReducedMotionPreference } from "../utils/useReducedMotion.js";
import { AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CELESTIAL_BODIES, CELESTIAL_GROUPS } from "../data/celestialBodies.js";
import SpatialSurface from "./SpatialSurface.jsx";
import "./SystemMenu.css";

const PLANET_LAYOUT = [
  ["mercury",34,-18],["venus",48,45],["earth",64,126],["mars",82,205],
  ["jupiter",104,278],["saturn",126,338],["uranus",148,70],["neptune",169,152],
];

function pointOnCircle(radius, degrees) {
  const angle = degrees * Math.PI / 180;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function BodyRow({ body, active, onSelect }) {
  return (
    <button type="button" className={`system-catalog__row ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => onSelect(body.id)}>
      <span
        className="system-catalog__thumb"
        style={{
          backgroundColor: body.color,
          backgroundImage: body.texture ? `url(${body.texture})` : "none",
        }}
      />
      <span className="system-catalog__copy">
        <strong>{body.name}</strong>
        <small>
          {body.type}
          {body.type === "Moon" ? ` // ${CELESTIAL_BODIES[body.parent]?.name || body.parent}` : ""}
        </small>
      </span>
    </button>
  );
}

export default function SystemMenu({ open, activeBodyId, onSelectBody, onClose }) {
  const reduced = useReducedMotionPreference();
  const [page, setPage] = useState("map");
  const [systemId, setSystemId] = useState(null);
  const mapRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !open) return;
    const count = Object.values(CELESTIAL_BODIES).filter(body => body.type === "Moon" && body.parent === systemId).length;
    const radius = systemId ? 75 + Math.max(0, count - 1) * 12 : 169;
    const fit = () => map.style.setProperty("--diagram-scale", Math.max(0.1, Math.min(1, (map.clientWidth - 100) / (radius * 2), (map.clientHeight - 26) / (radius * 2))));
    const observer = new ResizeObserver(fit); observer.observe(map); fit();
    return () => observer.disconnect();
  }, [open, systemId, page]);
  const moons = Object.values(CELESTIAL_BODIES).filter((body) => body.type === "Moon" && body.parent === systemId);
  function browseBody(id) {
    if (Object.values(CELESTIAL_BODIES).some((body) => body.type === "Moon" && body.parent === id)) { setSystemId(id); setPage("map"); }
    else onSelectBody(id);
  }


  return (
    <AnimatePresence>{open && <SpatialSurface as="aside" side="right" strength={3.8} className="system-menu hud-panel hud-panel--right" aria-label="Solar system navigation">
      <div className="system-menu__head hud-panel__header">
        <div>
          <span className="eyebrow">SYSTEM NAVIGATION</span>
          <h2>{page === "map" ? systemId ? `${CELESTIAL_BODIES[systemId].name} system` : "Solar System" : "Object Catalog"}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close system menu">
          <X size={18} />
        </button>
      </div>

      <div className="system-menu__tabs">
        <button type="button" className={page === "map" ? "is-active" : ""} aria-pressed={page === "map"} onClick={() => setPage("map")}>ORBIT MAP</button>
        <button type="button" className={page === "catalog" ? "is-active" : ""} aria-pressed={page === "catalog"} onClick={() => setPage("catalog")}>CATALOG</button>
      </div>

      <div className="system-menu__viewport">
        <div className="system-menu__track" data-page={page} style={reduced ? { transition: "none" } : undefined}>
          <section className="system-slide system-slide--map" inert={page !== "map"}>
            {systemId ? <>
              <button className="system-slide-back" onClick={() => setSystemId(null)}><ChevronLeft size={15} /> SOLAR SYSTEM</button>
              <div ref={mapRef} className="system-map subsystem-map">
                <button className="subsystem-parent" aria-pressed={activeBodyId === systemId} style={{ "--body-color": CELESTIAL_BODIES[systemId].color }} onClick={() => onSelectBody(systemId)}><i /><strong>{CELESTIAL_BODIES[systemId].name}</strong><small>VISIT PLANET</small></button>
                {moons.map((body, index) => { const radius = 75 + index * 12; const point = pointOnCircle(radius, index / moons.length * 360 - 90); return <div key={body.id} className="system-orbit" style={{ "--orbit-radius": `${radius}px`, borderColor: `${body.color}40` }}><button className={`system-planet ${activeBodyId === body.id ? "is-active" : ""}`} aria-pressed={activeBodyId === body.id} style={{ "--planet-color": body.color, "--orbit-x": `${point.x}px`, "--orbit-y": `${point.y}px` }} onClick={() => onSelectBody(body.id)}><i /><span>{body.name}</span></button></div>; })}
              </div>
            </> : <>
            <div className="system-map-back-slot" aria-hidden="true" />
            <div ref={mapRef} className="system-map">
              <button
                type="button"
                className={`system-map__sun ${activeBodyId === "sun" ? "is-active" : ""}`}
                onClick={() => onSelectBody("sun")}
                aria-label="Visit Sun"
                aria-pressed={activeBodyId === "sun"}
              >
                <span />
              </button>

              {PLANET_LAYOUT.map(([id, radius, angle]) => {
                const body = CELESTIAL_BODIES[id];
                const point = pointOnCircle(radius, angle);
                const activePlanet =
                  activeBodyId === id ||
                  CELESTIAL_BODIES[activeBodyId]?.parent === id;

                return (
                  <div
                    key={id}
                    className="system-orbit"
                    style={{ "--orbit-radius": `${radius}px`, borderColor: body.orbitColor }}
                  >
                    <button
                      type="button"
                      className={`system-planet ${activePlanet ? "is-active" : ""}`}
                      style={{
                        "--planet-color": body.color,
                        "--orbit-x": `${point.x}px`,
                        "--orbit-y": `${point.y}px`,
                      }}
                      onClick={() => browseBody(id)}
                      aria-pressed={activePlanet}
                    >
                      <i />
                      <span>{body.name}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            </>}

            <button type="button" className="system-slide-next" onClick={() => setPage("catalog")}>
              ALL OBJECTS <ChevronRight size={14} />
            </button>
            <div className="system-map__note">SCHEMATIC UI MAP // REAL DISTANCES ARE USED IN THE 3D SCENE</div>
          </section>

          <section className="system-slide system-slide--catalog" inert={page !== "catalog"}>
            <div className="system-catalog">
              {[
                ["Star","STAR"],
                ["Planet","PLANETS"],
                ["Moon","MOONS"],
                ["Dwarf Planet","DWARF PLANETS"],
                ["Asteroid","ASTEROIDS"],
              ].map(([type, title]) => (
                <div className="system-catalog__group" key={type}>
                  <div className="system-catalog__title">
                    <span>{title}</span>
                    <strong>{CELESTIAL_GROUPS[type].length}</strong>
                  </div>
                  <div className="system-catalog__rows">
                    {CELESTIAL_GROUPS[type].map((id) => (
                      <BodyRow
                        key={id}
                        body={CELESTIAL_BODIES[id]}
                        active={activeBodyId === id}
                        onSelect={browseBody}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="system-slide-back" onClick={() => setPage("map")}>
              <ChevronLeft size={14} /> ORBIT MAP
            </button>
          </section>
        </div>
      </div>

      <div className="system-menu__foot hud-panel__footer">
        <span>APPROXIMATE EPHEMERIS</span>
        <strong>{Object.keys(CELESTIAL_BODIES).length} OBJECTS</strong>
      </div>
    </SpatialSurface>}</AnimatePresence>
  );
}
