import { Check, KeyRound, Map, Tags, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { MAP_OPTIONS } from "../data/mapOptions.js";

export default function MapSettings({ open, mapStyle, onMapStyleChange, labelsEnabled, onLabelsChange, onClose, mapStatus }) {
  if (!open) return null;
  const hasCartoKey = Boolean(import.meta.env.VITE_CARTO_API_KEY);
  const fixedLabels = ["osm", "bing-road"].includes(mapStyle);

  return (
    <SpatialSurface as="aside" side="right" strength={3.2} className="map-settings hud-panel hud-panel--right" aria-label="Map settings">
      <div className="map-settings__head hud-panel__header" data-depth="2">
        <div>
          <div className="eyebrow"><Map size={15} /> MAP SETTINGS</div>
          <h2>Choose the Earth</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close map settings"><X size={20} /></button>
      </div>

      <div className="hud-panel__body map-settings__body">
      {mapStatus && <p role="status" className="inline-warning">{mapStatus}</p>}

      <div className="map-gallery" data-depth="4">
        {MAP_OPTIONS.map((map) => {
          const active = mapStyle === map.id;
          const unavailable = (map.requiresCartoKey && !hasCartoKey) || (["google", "bing", "bing-labels", "bing-road"].includes(map.id) && !import.meta.env.VITE_CESIUM_ION_TOKEN);
          return (
            <button
              key={map.id}
              className={`map-card ${active ? "is-active" : ""} ${unavailable ? "is-unavailable" : ""}`}
              onClick={() => !unavailable && onMapStyleChange(map.id)}
              aria-pressed={active}
              disabled={unavailable}
              title={unavailable ? "Provider key unavailable" : map.name}
            >
              <span className="map-card__preview"><img src={map.preview} alt="" width="320" height="180" /></span>
              <span className="map-card__copy"><strong>{map.name}</strong>{unavailable && <small><KeyRound size={13} /> KEY</small>}</span>
              {active && <span className="map-card__check"><Check size={15} /></span>}
            </button>
          );
        })}
      </div>

      <button className={`setting-toggle ${labelsEnabled || fixedLabels ? "is-active" : ""}`} disabled={fixedLabels} onClick={() => onLabelsChange(!labelsEnabled)} aria-pressed={labelsEnabled || fixedLabels} data-depth="5">
        <Tags size={19} />
        <span><strong>Place labels</strong><small>{fixedLabels ? "Names are part of this provider’s map. Choose satellite imagery to hide them." : "Country and city names appear as you zoom in. For streets, choose Bing Labels or OpenStreetMap."}</small></span>
        <i>{labelsEnabled || fixedLabels ? "ON" : "OFF"}</i>
      </button>
      </div>
    </SpatialSurface>
  );
}
