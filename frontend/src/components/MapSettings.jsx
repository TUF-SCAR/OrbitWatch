import { Check, KeyRound, Map, Tags, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { MAP_OPTIONS } from "../data/mapOptions.js";

export default function MapSettings({ open, mapStyle, onMapStyleChange, labelsEnabled, onLabelsChange, onClose }) {
  if (!open) return null;
  const hasCartoKey = Boolean(import.meta.env.VITE_CARTO_API_KEY);

  return (
    <SpatialSurface as="aside" side="right" strength={3.2} className="map-settings" aria-label="Map settings">
      <div className="map-settings__head" data-depth="2">
        <div>
          <div className="eyebrow"><Map size={15} /> MAP SETTINGS</div>
          <h2>Choose the Earth</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close map settings"><X size={20} /></button>
      </div>

      <div className="map-gallery" data-depth="4">
        {MAP_OPTIONS.map((map) => {
          const active = mapStyle === map.id;
          const unavailable = map.requiresCartoKey && !hasCartoKey;
          return (
            <button
              key={map.id}
              className={`map-card ${active ? "is-active" : ""} ${unavailable ? "is-unavailable" : ""}`}
              onClick={() => !unavailable && onMapStyleChange(map.id)}
              aria-pressed={active}
              disabled={unavailable}
              title={unavailable ? "Add a CARTO basemap API key to enable this map" : map.name}
            >
              <span className="map-card__preview"><img src={map.preview} alt="" /></span>
              <span className="map-card__copy"><strong>{map.name}</strong>{unavailable && <small><KeyRound size={13} /> KEY</small>}</span>
              {active && <span className="map-card__check"><Check size={15} /></span>}
            </button>
          );
        })}
      </div>

      <button className={`setting-toggle ${labelsEnabled ? "is-active" : ""}`} onClick={() => onLabelsChange(!labelsEnabled)} aria-pressed={labelsEnabled} data-depth="5">
        <Tags size={19} />
        <span><strong>Place labels</strong><small>Show city and place names.</small></span>
        <i>{labelsEnabled ? "ON" : "OFF"}</i>
      </button>
    </SpatialSurface>
  );
}
