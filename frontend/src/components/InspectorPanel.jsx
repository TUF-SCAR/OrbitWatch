import { BookOpen, Crosshair, Eye, EyeOff, Radio, RotateCcw, X } from "lucide-react";
import { useCallback, useState } from "react";
import SpatialSurface from "./SpatialSurface.jsx";
import SatelliteModelViewer from "./SatelliteModelViewer.jsx";
import { getSatelliteModelUrl } from "../data/satelliteModels.js";
import { formatAltitude, formatCoordinate, formatUtcTime } from "../utils/spaceFormatters.js";
import { getObjectReferenceUrl } from "../data/objectReferences.js";
import { OBJECT_PHOTOS } from "../data/objectPhotos.js";
export default function InspectorPanel({ object, telemetry, telemetryError, cameraFollowing, rendered, orbitVisible, onClose, onFocus, onFollow, onReleaseCamera, onToggleOrbit, preview3d }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [previewTab, setPreviewTab] = useState(preview3d ? "model" : "photo");
  const unavailable = useCallback(() => { setModelFailed(true); setPreviewTab("photo"); }, []);
  if (!object) return null;
  const photo = OBJECT_PHOTOS[object.noradId];
  const model = getSatelliteModelUrl(object);
  const referenceUrl = getObjectReferenceUrl(object);
  return <SpatialSurface as="aside" side="right" strength={4.5} className="inspector-panel" aria-label="Object inspector">
    <div className="inspector-panel__head"><div><div className="eyebrow">OBJECT OVERVIEW</div><h1>{object.name}</h1></div><button className="icon-button" onClick={onClose} aria-label="Close inspector"><X size={20} /></button></div>
    <div className="object-ident"><span>{object.category}</span><span>NORAD {object.noradId}</span></div>
    {preview3d && model && <div className="preview-tabs"><button onClick={() => setPreviewTab("photo")} aria-pressed={previewTab === "photo"}>2D PHOTO</button><button onClick={() => { setModelFailed(false); setPreviewTab("model"); }} aria-pressed={previewTab === "model"}>{modelFailed ? "RETRY 3D MODEL" : "3D MODEL"}</button></div>}
    <div className="inspector-preview">{preview3d && model && previewTab === "model" && !modelFailed ? <SatelliteModelViewer object={object} onUnavailable={unavailable} /> : photo && !photoFailed ? <figure><img src={photo.url} alt={photo.alt} onError={() => setPhotoFailed(true)} width="640" height="400" /><figcaption><a href={photo.source} target="_blank" rel="noreferrer">{photo.credit} · Reference photograph ↗</a></figcaption></figure> : <div className="preview-unavailable">Official photograph unavailable for this object.<small>No substitute spacecraft is shown.</small></div>}</div>{preview3d && (!model || modelFailed) && <p className="preview-notice">Verified 3D model unavailable; showing reference media.</p>}
    <div className="inspector-actions"><button className="secondary-action" onClick={onFocus} disabled={!rendered}><Crosshair size={18} /> Focus</button>{cameraFollowing ? <button className="primary-action is-following" onClick={onReleaseCamera}><RotateCcw size={18} /> Release</button> : <button className="primary-action" onClick={onFollow} disabled={!rendered}><Radio size={18} /> Follow</button>}<button className={`secondary-action ${orbitVisible ? "is-active" : ""}`} onClick={onToggleOrbit} disabled={!rendered}>{orbitVisible ? <EyeOff size={18} /> : <Eye size={18} />}{orbitVisible ? "Hide orbit" : "Show orbit"}</button></div>
    {referenceUrl && <a className="inspector-reference" href={referenceUrl} target="_blank" rel="noreferrer"><BookOpen size={14} /> Mission reference ↗</a>}
    <div className="inspector-scroll"><div className="telemetry-grid"><div className="telemetry-primary"><small>ALTITUDE</small><strong>{formatAltitude(telemetry?.altitude_km)}</strong></div><div><small>LATITUDE</small><strong>{formatCoordinate(telemetry?.latitude, "N", "S")}</strong></div><div><small>LONGITUDE</small><strong>{formatCoordinate(telemetry?.longitude, "E", "W")}</strong></div><div><small>SAMPLE UTC</small><strong>{formatUtcTime(telemetry?.timestamp)}</strong></div></div>
    {telemetryError && <p className="inline-warning">Telemetry unavailable — retrying automatically.</p>}{!rendered && <p className="inline-warning">Not loaded on the globe. Use Objects to load it.</p>}
    <div className="inspector-meta">{[["TYPE", object.objectType], ["OPERATOR", object.operator], ["REGION", object.country], ["STATUS", object.status], ["LAUNCHED", object.launchDate], ["PURPOSE", object.purpose], ["SOURCE", telemetry?.orbital_source], ["TLE EPOCH", telemetry?.tle_epoch]].filter(([, value]) => value).map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <p>Positions are propagated from orbital elements, not onboard telemetry. Photographs show the documented mission configuration.</p></div>
  </SpatialSurface>;
}
