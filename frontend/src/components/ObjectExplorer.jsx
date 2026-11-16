import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import MobileCatalog from './MobileCatalog.jsx';

export default function ObjectExplorer({ open, onClose, objects, trackedIds, selectedId, onSelect, onLoad, onUnload, limitMessage, userId, searchCycle = 0, historical = false }) {
  const [filterDraft,setFilterDraft]=useState({category:'All',country:'All',collectionId:''});
  const storageKey = `orbitwatch_collections_${userId}${historical ? '_time' : ''}`;
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
  const selectedIds = [...selected].filter(id=>objects.some(object=>object.noradId===id));

  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected; }, [someSelected, allSelected, open]);
  useEffect(() => {
    if (!chooser) return;
    const node=chooserRef.current;
    node.showModal();
    (node.querySelector("input") || node.querySelector("button"))?.focus();
    return () => { node.close(); if (chooserTriggerRef.current?.isConnected) chooserTriggerRef.current.focus(); };
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



  const chooserDialog = chooser && <dialog ref={chooserRef} onCancel={event=>{event.preventDefault();event.stopPropagation();setChooser(null);}} onKeyDown={event=>{chooserKeys(event);event.stopPropagation();}} className="collection-chooser" aria-label="Manage custom filter"><button type="button" className="icon-button" aria-label="Close collection chooser" onClick={() => setChooser(null)}><X size={16} /></button><h3>{chooser.kind === "rename" ? "Rename collection" : "Add to your collection"}</h3>{chooser.kind === "add" && collections.map((item) => <button type="button" key={item.id} onClick={() => addToCollection(item.id)}>{item.name}</button>)}<form onSubmit={submitName}><label>{chooser.kind === "rename" ? "Collection name" : "Create new filter"}<input autoFocus required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} /></label><button type="submit">{chooser.kind === "rename" ? "RENAME" : "CREATE"}</button></form></dialog>;
  return <MobileCatalog searchCycle={searchCycle} open={open} onClose={onClose} label="object explorer" title="Objects" count={objects.length} query={query} onQuery={setQuery}
    filterCount={Number(category!=='All')+Number(country!=='All')+Number(Boolean(collectionId))}
    onApply={()=>{setCategory(filterDraft.category);setCountry(filterDraft.country);setCollectionId(filterDraft.collectionId);}}
    onClear={()=>{setCategory('All');setCountry('All');setCollectionId('');setFilterDraft({category:'All',country:'All',collectionId:''});}}
    filters={<><label>Type<select aria-label="Type" value={filterDraft.category} onChange={e=>setFilterDraft(v=>({...v,category:e.target.value}))}>{['All',...new Set(objects.map(o=>o.category))].map(v=><option key={v}>{v}</option>)}</select></label><label>Region<select aria-label="Region" value={filterDraft.country} onChange={e=>setFilterDraft(v=>({...v,country:e.target.value}))}>{['All',...new Set(objects.map(o=>o.country))].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Collections<select aria-label="Collections" value={filterDraft.collectionId} onChange={e=>setFilterDraft(v=>({...v,collectionId:e.target.value}))}><option value="">All collections</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="mobile-collection-actions"><button onClick={()=>{setName('');openChooser({kind:'create',ids:[]});}}>Create collection</button>{collection&&<><button onClick={()=>{setName(collection.name);openChooser({kind:'rename',ids:[]});}}>Rename collection</button><button onClick={()=>{saveCollections(collections.filter(c=>c.id!==collectionId));setCollectionId('');setFilterDraft(v=>({...v,collectionId:''}));}}>Delete collection</button></>}</div></>}
    bulk={selectedIds.length>0&&<div className="mobile-catalog__bulk"><label><input type="checkbox" ref={allRef} checked={allSelected} onChange={selectVisible}/> All results</label><button onClick={()=>setSelected(new Set())}>Clear {selectedIds.length}</button><button onClick={()=>onLoad(selectedIds)}>Load</button><button onClick={()=>onUnload(selectedIds)}>Unload</button><button onClick={()=>openChooser({kind:'add',ids:selectedIds})}>Add to collection</button></div>}
    footer={<span>{filtered.length} results · {trackedIds.length} loaded · {selectedIds.length} selected</span>} dialog={chooserDialog}>
    {(limitMessage||message)&&<p role="status">{limitMessage||message}</p>}
    {!filtered.length&&<p>No objects match your search and filters.</p>}
    {filtered.map(item=><article key={item.noradId} className={`mobile-object-row ${selectedId===item.noradId?'is-selected':''}`}>
     <label className="mobile-object-select"><input type="checkbox" checked={selected.has(item.noradId)} onChange={()=>toggleSelection(item.noradId)} aria-label={`Select ${item.name} for bulk actions`}/></label>
     <button type="button" className="mobile-object-name" onClick={()=>onSelect(item.noradId)} aria-current={selectedId===item.noradId?'true':undefined}><strong>{item.name}</strong><small>{item.category} · NORAD {item.noradId}</small><span>{tracked.has(item.noradId)?'● Loaded':'Not loaded'}{selectedId===item.noradId?' · Inspecting':''}</span></button>
     <div className="mobile-object-actions"><button onClick={()=>tracked.has(item.noradId)?onUnload([item.noradId]):onLoad([item.noradId])}>{tracked.has(item.noradId)?'Unload':'Load'}</button><button aria-label={`Add ${item.name} to collection`} onClick={()=>openChooser({kind:'add',ids:[item.noradId]})}>Collection +</button>{collection&&<button aria-label={`Remove ${item.name} from collection`} onClick={()=>saveCollections(collections.map(c=>c.id===collectionId?{...c,ids:c.ids.filter(id=>id!==item.noradId)}:c))}>Remove</button>}</div>
    </article>)}
  </MobileCatalog>;

}
