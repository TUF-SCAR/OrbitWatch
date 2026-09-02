import { Camera, Map } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

export default function SceneDock({ mode, mapOpen, onToggleMap, cameraOpen, onToggleCamera }) {
  return (
    <SpatialSurface as="aside" side="right" strength={3.1} className="scene-dock" aria-label="Globe controls">
      {mode !== "disaster" && (
        <button className={`scene-tool ${mapOpen ? "is-active" : ""}`} onClick={onToggleMap} title="Map settings" data-depth="3">
          <Map size={19} /><span>Map</span>
        </button>
      )}
      <button className={`scene-tool ${cameraOpen ? "is-active" : ""}`} onClick={onToggleCamera} title="Camera angles" data-depth="4">
        <Camera size={19} /><span>Camera</span>
      </button>
    </SpatialSurface>
  );
}
