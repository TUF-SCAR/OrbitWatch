import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Search, X, Plus, Trash2, Pencil } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

export default function ObjectExplorer({ open, onClose, objects, trackedIds, selectedId, onSelect, onLoad, onUnload, limitMessage, userId, searchCycle = 0 }) {
  const storageKey = `orbitwatch_collections_${userId}`;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [country, setCountry] = useState("All");
  const [collectionId, setCollectionId] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [chooser, setChooser] = useState(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [collections, setCollections] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved) ? saved.filter((item) => typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.ids)) : [];
    } catch { return []; }
  });
  const searchRef = useRef(null);
  const allRef = useRef(null);
  const chooserRef = useRef(null);
  const chooserTriggerRef = useRef(null);
  const tracked = new Set(trackedIds);
  const collection = collections.find((item) => item.id === collectionId);
  const normalized = query.trim().toLowerCase();
  const filtered = objects.filter((item) =>
    (category === "All" || item.category === category) &&
    (country === "All" || item.country === country) &&
    (!collection || collection.ids.includes(item.noradId)) &&
    `${item.name} ${item.noradId} ${item.operator} ${item.country} ${item.category} ${(item.aliases || []).join(" ")}`.toLowerCase().includes(normalized),
  );
  const allSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.noradId));
  const someSelected = filtered.some((item) => selected.has(item.noradId));
  const selectedIds = [...selected];

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open, searchCycle]);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected; }, [someSelected, allSelected, open]);
  useEffect(() => {
    if (!chooser) return;
    (chooserRef.current?.querySelector("input") || chooserRef.current?.querySelector("button"))?.focus();
    return () => { if (chooserTriggerRef.current?.isConnected) chooserTriggerRef.current.focus(); };
  }, [chooser]);

  function openChooser(next) { chooserTriggerRef.current = document.activeElement; setChooser(next); }
  function chooserKeys(event) {
    if (event.key !== "Tab") return;
    const items = [...chooserRef.current.querySelectorAll("button:not(:disabled), input, select, a[href]")];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function saveCollections(next) {
    setCollections(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setMessage("Collections are available for this session; browser storage is unavailable."); }
  }
  function toggleSelection(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      filtered.forEach((item) => { if (allSelected) next.delete(item.noradId); else next.add(item.noradId); });
      return next;
    });
  }
  function addToCollection(id) {
    saveCollections(collections.map((item) => item.id === id ? { ...item, ids: [...new Set([...item.ids, ...chooser.ids])] } : item));
    setChooser(null);
    setMessage("Objects added to collection.");
  }
  function submitName(event) {
    event.preventDefault();
    const title = name.trim();
    if (!title) return;
    if (chooser.kind === "rename") {
      saveCollections(collections.map((item) => item.id === collectionId ? { ...item, name: title } : item));
    } else {
      saveCollections([...collections, { id: crypto.randomUUID(), name: title, ids: chooser.ids }]);
    }
    setChooser(null);
    setName("");
  }


  return (
    <AnimatePresence>{open && <SpatialSurface as="aside" side="left" strength={1.2} className="object-explorer hud-panel hud-panel--left" aria-label="Object explorer" onKeyDown={(event) => {
      if (event.key === "Escape" && chooser) { event.stopPropagation(); setChooser(null); }
    }}>
      <div className="object-explorer__head hud-panel__header">
        <div><div className="eyebrow">CATALOG / {objects.length} OBJECTS</div><h2>Object Explorer</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close object explorer"><X size={18} /></button>
      </div>
      <div className="explorer-body hud-panel__body">
      <label className="search-field"><Search size={16} /><span className="sr-only">Search objects</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, NORAD, operator, country…" /></label>
      <div className="explorer-filters">
        <label>TYPE<select value={category} onChange={(event) => setCategory(event.target.value)}>{["All", ...new Set(objects.map((item) => item.category))].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>REGION<select value={country} onChange={(event) => setCountry(event.target.value)}>{["All", ...new Set(objects.map((item) => item.country))].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="collection-controls">
        <label><span className="sr-only">Your custom collections</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">ALL COLLECTIONS</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button type="button" aria-label="Create custom filter" title="Create custom filter" onClick={() => { setName(""); openChooser({ kind: "create", ids: [] }); }}><Plus size={16} /></button>
        {collection && <><button type="button" aria-label="Rename collection" onClick={() => { setName(collection.name); openChooser({ kind: "rename", ids: [] }); }}><Pencil size={15} /></button><button type="button" aria-label="Delete collection" onClick={() => { saveCollections(collections.filter((item) => item.id !== collectionId)); setCollectionId(""); }}><Trash2 size={15} /></button></>}
      </div>
      <div className="selection-toolbar"><label><input ref={allRef} type="checkbox" checked={allSelected} disabled={!filtered.length} onChange={selectVisible} /> SELECT ALL RESULTS</label><button type="button" onClick={() => setSelected(new Set())}>CLEAR {selected.size}</button></div>
      {(limitMessage || message) && <div className="limit-message" role="status">{limitMessage || message}</div>}
      <div className="object-list">
        {!filtered.length && <p className="empty-state">No objects match these filters.</p>}
        {filtered.map((item) => <div key={item.noradId} className={`object-row ${selectedId === item.noradId ? "is-selected" : ""}`}>
          <input className="object-checkbox" type="checkbox" checked={selected.has(item.noradId)} onChange={() => toggleSelection(item.noradId)} aria-label={`Select ${item.name} for bulk actions`} />
          <button type="button" className="object-row__main" onClick={() => onSelect(item.noradId)}><span className="object-row__copy"><strong>{item.name}</strong><small>{item.category} · {item.noradId}{tracked.has(item.noradId) ? " · LOADED" : ""}</small></span></button>
          <div className="object-row__actions"><button type="button" onClick={() => tracked.has(item.noradId) ? onUnload([item.noradId]) : onLoad([item.noradId])}>{tracked.has(item.noradId) ? "UNLOAD" : "LOAD"}</button><button type="button" aria-label={`Add ${item.name} to collection`} onClick={() => openChooser({ kind: "add", ids: [item.noradId] })}>ADD</button>{collection && <button type="button" aria-label={`Remove ${item.name} from collection`} onClick={() => saveCollections(collections.map((group) => group.id === collectionId ? { ...group, ids: group.ids.filter((id) => id !== item.noradId) } : group))}>REMOVE</button>}</div>
        </div>)}
      </div>
      </div>
      {selected.size >= 2 && <div className="selection-actions"><button type="button" disabled={!selectedIds.every((id) => !tracked.has(id))} onClick={() => onLoad(selectedIds)}>LOAD</button><button type="button" disabled={!selectedIds.every((id) => tracked.has(id))} onClick={() => onUnload(selectedIds)}>UNLOAD</button><button type="button" onClick={() => openChooser({ kind: "add", ids: selectedIds })}>ADD</button></div>}
      <div className="object-explorer__foot hud-panel__footer"><span>{filtered.length} results · {selected.size} selected</span><span>{trackedIds.length} loaded</span></div>
      {chooser && <div ref={chooserRef} onKeyDown={chooserKeys} className="collection-chooser" role="dialog" aria-modal="true" aria-label="Manage custom filter"><button type="button" className="icon-button" aria-label="Close collection chooser" onClick={() => setChooser(null)}><X size={16} /></button><h3>{chooser.kind === "rename" ? "Rename collection" : "Add to your collection"}</h3>{chooser.kind === "add" && collections.map((item) => <button type="button" key={item.id} onClick={() => addToCollection(item.id)}>{item.name}</button>)}<form onSubmit={submitName}><label>{chooser.kind === "rename" ? "Collection name" : "Create new filter"}<input autoFocus required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} /></label><button type="submit">{chooser.kind === "rename" ? "RENAME" : "CREATE"}</button></form></div>}
    </SpatialSurface>}</AnimatePresence>
  );
}
