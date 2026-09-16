import { Camera, Map, Orbit } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

export default function SceneDock({
  mode,
  mapOpen,
  onToggleMap,
  cameraOpen,
  onToggleCamera,
  systemOpen,
  onToggleSystem,
}) {
  return (
    <SpatialSurface as="aside" side="right" strength={3.1} className="scene-dock" aria-label="Scene controls">
      {mode !== "disaster" ? (
        <button className={`scene-tool ${mapOpen ? "is-active" : ""}`} onClick={onToggleMap} title="Map settings" data-depth="3">
          <Map size={19} /><span>Map</span>
        </button>
      ) : null}

      <button className={`scene-tool ${cameraOpen ? "is-active" : ""}`} onClick={onToggleCamera} title="Camera angles" data-depth="4">
        <Camera size={19} /><span>Camera</span>
      </button>

      <button className={`scene-tool ${systemOpen ? "is-active" : ""}`} onClick={onToggleSystem} title="Solar system" data-depth="5">
        <Orbit size={19} /><span>System</span>
      </button>
    </SpatialSurface>
  );
}
