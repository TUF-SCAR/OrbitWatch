import { useMemo, useState } from "react";
import { Check, ChevronRight, Search, Star, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";
import { OBJECT_CATEGORIES, SPACE_OBJECTS } from "../data/spaceObjects.js";

export default function ObjectExplorer({ open, onClose, trackedIds, selectedId, onSelect, onToggleTracked, maxTracked, limitMessage }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return SPACE_OBJECTS.filter((item) => {
      const categoryMatch = category === "All" || item.category === category;
      const textMatch = !normalized || `${item.name} ${item.noradId} ${item.operator}`.toLowerCase().includes(normalized);
      return categoryMatch && textMatch;
    });
  }, [query, category]);

  if (!open) return null;

  return (
    <SpatialSurface as="aside" side="left" strength={4.7} className="object-explorer" aria-label="Object explorer">
      <div className="object-explorer__head" data-depth="3">
        <div><div className="eyebrow">CATALOGUE / {SPACE_OBJECTS.length} OBJECTS</div><h2>Object Explorer</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close object explorer"><X size={18} /></button>
      </div>

      <label className="search-field" data-depth="5"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, NORAD or operator" autoFocus /></label>

      <div className="category-strip" data-depth="4">
        {OBJECT_CATEGORIES.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? "is-active" : ""}>{item}</button>)}
      </div>

      {limitMessage && <div className="limit-message" data-depth="6">{limitMessage}</div>}

      <div className="object-list" data-depth="6">
        {filtered.map((item) => {
          const tracked = trackedIds.includes(item.noradId);
          const atLimit = Boolean(maxTracked && trackedIds.length >= maxTracked && !tracked);
          return (
            <div key={item.noradId} className={`object-row ${selectedId === item.noradId ? "is-selected" : ""}`}>
              <button className="object-row__main" onClick={() => onSelect(item.noradId)}>
                <span className={`object-dot object-dot--${item.category.toLowerCase().replace(/\s+/g, "-")}`} />
                <span className="object-row__copy"><strong>{item.name}</strong><small>{item.category} · NORAD {item.noradId}</small></span>
                {item.featured && <Star className="object-row__star" size={13} fill="currentColor" />}
                <ChevronRight size={15} />
              </button>
              <button className={`track-toggle ${tracked ? "is-active" : ""}`} onClick={() => onToggleTracked(item.noradId)} disabled={atLimit} title={tracked ? "Remove from globe" : atLimit ? `Time Explorer limit: ${maxTracked}` : "Add to globe"}>{tracked ? <Check size={14} /> : "+"}</button>
            </div>
          );
        })}
      </div>

      <div className="object-explorer__foot" data-depth="3">
        <span>{filtered.length} results</span>
        <span>{trackedIds.length}{maxTracked ? ` / ${maxTracked}` : ""} on globe</span>
      </div>
    </SpatialSurface>
  );
}
