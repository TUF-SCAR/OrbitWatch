import { BookOpen, Crosshair, Eye, EyeOff, Radio, RotateCcw, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { formatAltitude, formatCoordinate, formatUtcTime } from "../utils/spaceFormatters.js";
import { getObjectReferenceUrl } from "../data/objectReferences.js";

export default function InspectorPanel({
  object,
  telemetry,
  telemetryError,
  cameraFollowing,
  rendered,
  orbitVisible,
  onClose,
  onFocus,
  onFollow,
  onReleaseCamera,
  onToggleOrbit,
}) {
  if (!object) return null;
  const referenceUrl = getObjectReferenceUrl(object);

  return (
    <SpatialSurface as="aside" side="right" strength={4.5} className="inspector-panel">
      <div className="inspector-panel__head" data-depth="3">
        <div>
          <div className="eyebrow">OBJECT OVERVIEW</div>
          <h1>{object.name}</h1>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={20} /></button>
      </div>

      <div className="object-ident" data-depth="4">
        <span>{object.category}</span><span>NORAD {object.noradId}</span>
      </div>

      <div className="telemetry-grid" data-depth="6">
        <div className="telemetry-primary"><small>ALTITUDE</small><strong>{formatAltitude(telemetry?.altitude_km)}</strong></div>
        <div><small>LATITUDE</small><strong>{formatCoordinate(telemetry?.latitude, "N", "S")}</strong></div>
        <div><small>LONGITUDE</small><strong>{formatCoordinate(telemetry?.longitude, "E", "W")}</strong></div>
        <div><small>SAMPLE</small><strong>{formatUtcTime(telemetry?.timestamp)}</strong></div>
      </div>

      {telemetryError && <div className="inline-warning" data-depth="3">Telemetry unavailable — reconnecting automatically.</div>}
      {!rendered && <div className="inline-warning" data-depth="3">This object is not currently displayed on the globe.</div>}

      <div className="inspector-meta" data-depth="4">
        <div><span>TYPE</span><b>{object.objectType}</b></div>
        <div><span>OPERATOR</span><b>{object.operator}</b></div>
        <div><span>REGION</span><b>{object.country}</b></div>
        <div><span>STATUS</span><b className="status-active">● {object.status}</b></div>
      </div>

      <div className="inspector-actions" data-depth="8">
        <button className="secondary-action" onClick={onFocus} disabled={!rendered || cameraFollowing}><Crosshair size={18} /> Focus</button>
        {!cameraFollowing ? (
          <button className="primary-action" onClick={onFollow} disabled={!rendered}><Radio size={18} /> Follow</button>
        ) : (
          <button className="primary-action is-following" onClick={onReleaseCamera}><RotateCcw size={18} /> Release</button>
        )}
        <button className={`secondary-action ${orbitVisible ? "is-active" : ""}`} onClick={onToggleOrbit} disabled={!rendered}>
          {orbitVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          {orbitVisible ? "Hide orbit" : "Show orbit"}
        </button>
        {referenceUrl && (
          <a className="secondary-action reference-action" href={referenceUrl} target="_blank" rel="noreferrer">
            <BookOpen size={18} /> Wiki ↗
          </a>
        )}
      </div>
    </SpatialSurface>
  );
}
