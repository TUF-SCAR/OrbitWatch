import { Activity, Clock3, Flame, Satellite } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

const modes = [
  { id: "live", label: "Live", icon: Activity },
  { id: "time", label: "Time", icon: Clock3 },
  { id: "disaster", label: "Lab", icon: Flame },
];

export default function ModeRail({ mode, onChange }) {
  return (
    <SpatialSurface as="nav" side="left" strength={3.6} className="mode-rail" aria-label="OrbitWatch modes">
      <div className="mode-rail__mark" title="OrbitWatch" data-depth="4"><Satellite size={18} /></div>
      <div className="mode-rail__line" />
      {modes.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          className={`mode-button ${mode === id ? "is-active" : ""}`}
          onClick={() => onChange(id)}
          aria-pressed={mode === id}
          title={`${label} mode`}
          data-depth={3 + index}
        >
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
        </button>
      ))}
    </SpatialSurface>
  );
}
