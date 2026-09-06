import { Crosshair, MapPin, Orbit, RefreshCcw, Satellite } from "lucide-react";
import { useEffect, useState } from "react";
import SpatialSurface from "./SpatialSurface.jsx";

function formatCameraAltitude(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M km`;
  if (value >= 1000) return `${Math.round(value).toLocaleString()} km`;
  return `${value.toFixed(value < 10 ? 1 : 0)} km`;
}

function formatCursor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns}  ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export default function LiveDock({
  selectedObject,
  viewTelemetry,
  onRefresh,
  trackedCount = 0,
  allOrbitsVisible = false,
  onToggleAllOrbits,
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const utc = now.toLocaleTimeString("en-GB", {
    hour12: false,
    timeZone: "UTC",
  });

  return (
    <SpatialSurface
      side="bottom"
      strength={2.8}
      className="live-dock live-telemetry-dock"
    >
      <div className="telemetry-item" data-depth="3">
        <span>UTC</span><strong>{utc}</strong>
      </div>
      <div className="dock-divider" />
      <div className="telemetry-item" data-depth="4">
        <Satellite size={18} />
        <span>CAMERA</span>
        <strong>{formatCameraAltitude(viewTelemetry?.cameraAltitudeKm)}</strong>
      </div>
      <div className="dock-divider" />
      <div className="telemetry-item telemetry-item--cursor" data-depth="5">
        <MapPin size={18} />
        <span>CURSOR</span>
        <strong>
          {formatCursor(
            viewTelemetry?.cursorLatitude,
            viewTelemetry?.cursorLongitude,
          )}
        </strong>
      </div>

      {selectedObject && (
        <>
          <div className="dock-divider" />
          <div className="telemetry-item telemetry-item--selected" data-depth="5">
            <Crosshair size={18} />
            <span>SELECTED</span>
            <strong>{selectedObject.name}</strong>
          </div>
        </>
      )}

      <div className="dock-divider" />
      <button
        className={`dock-command dock-command--orbit ${allOrbitsVisible ? "is-active" : ""}`}
        onClick={onToggleAllOrbits}
        disabled={!trackedCount}
        title={allOrbitsVisible ? "Hide all loaded satellite orbits" : "Show all loaded satellite orbits"}
        data-depth="5"
      >
        <Orbit size={17} />
        <span>{allOrbitsVisible ? "HIDE ORBITS" : "SHOW ORBITS"}</span>
        <b>{trackedCount}</b>
      </button>

      <button
        className="dock-command dock-command--icon"
        onClick={onRefresh}
        title="Refresh live satellite positions"
        aria-label="Refresh live satellite positions"
        data-depth="5"
      >
        <RefreshCcw size={19} />
      </button>
    </SpatialSurface>
  );
}
