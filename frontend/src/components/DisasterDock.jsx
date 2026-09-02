import { Box, CloudLightning, Flame, Layers3, Map, Mountain, Waves } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

const layers = [
  { id: "wildfires", name: "Wildfire", icon: Flame },
  { id: "severeStorms", name: "Storm", icon: CloudLightning },
  { id: "floods", name: "Flood", icon: Waves },
  { id: "volcanoes", name: "Volcano", icon: Mountain },
];

export default function DisasterDock({ activeLayers, onLayersChange, sceneMode, onSceneModeChange }) {
  function toggleLayer(layerId) {
    onLayersChange((current) => current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]);
  }

  return (
    <SpatialSurface as="aside" side="left" strength={4} className="disaster-dock">
      <div className="disaster-dock__head" data-depth="3">
        <div><div className="eyebrow">DISASTER LAB</div><div className="disaster-dock__title"><Layers3 size={19} /> LIVE EARTH LAYERS</div></div>
        <span className="source-chip">LIVE</span>
      </div>

      <div className="lab-view-switch" data-depth="6">
        <button className={sceneMode === "3d" ? "is-active" : ""} onClick={() => onSceneModeChange("3d")}><Box size={18} />3D</button>
        <button className={sceneMode === "2d" ? "is-active" : ""} onClick={() => onSceneModeChange("2d")}><Map size={18} />2D</button>
      </div>

      <div className="disaster-layer-list" data-depth="5">
        {layers.map(({ id, name, icon: Icon }) => {
          const active = activeLayers.includes(id);
          return <button key={id} className={active ? "is-active" : ""} onClick={() => toggleLayer(id)} aria-pressed={active}><Icon size={20} /><span>{name}</span><small>{active ? "VISIBLE" : "HIDDEN"}</small></button>;
        })}
      </div>
    </SpatialSurface>
  );
}
