import { CircleDot, Globe2, Moon, Navigation, Satellite, Sun, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

const cameraPresets = [
  { id: "earth", label: "Earth", icon: Globe2 },
  { id: "north", label: "North", icon: Navigation },
  { id: "day", label: "Day", icon: Sun },
  { id: "night", label: "Night", icon: Moon },
  { id: "selected", label: "Selected", icon: Satellite },
];

export default function CameraMenu({ open, hasSelected, onPreset, onClose }) {
  if (!open) return null;
  return (
    <SpatialSurface as="aside" side="right" strength={2.5} className="camera-popover" aria-label="Camera angles">
      <div className="camera-popover__head">
        <div className="camera-popover__title"><CircleDot size={16} /> CAMERA ANGLES</div>
        <button className="icon-button" onClick={onClose} aria-label="Close camera menu"><X size={18} /></button>
      </div>
      <div className="camera-popover__grid">
        {cameraPresets.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onPreset(id)} disabled={id === "selected" && !hasSelected}>
            <Icon size={19} /><span>{label}</span>
          </button>
        ))}
      </div>
    </SpatialSurface>
  );
}
