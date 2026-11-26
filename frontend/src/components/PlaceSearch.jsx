import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import WorkspaceDialog from "./WorkspaceDialog.jsx";
import { usePhoneUI } from "../utils/usePhoneUI.js";

function SearchForm({ query, setQuery, onClose, onVisit, globeRef, phone = false }) {
  const [results, setResults] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState("loading");
    setResults([]);
    setError("");
    try {
      const items = await globeRef.current?.searchPlaces(query.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setResults(items || []);
      setState(items?.length ? "ready" : "empty");
    } catch (error) { if (!controller.signal.aborted) { setState("error"); setError(error.message || "Place search unavailable. Try again."); } }
  }
  function changeQuery(event) {
    requestRef.current?.abort();
    setQuery(event.target.value);
    setResults([]);
    setState("idle");
    setError("");
  }
  return <><form onSubmit={search} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}><label><span className="sr-only">Place or address</span><input autoFocus={!phone} value={query} onChange={changeQuery} placeholder="Place or address" /></label><button type="submit" aria-label="Search places" disabled={state === "loading" || !query.trim()}><Search size={17} /></button>{!phone&&<button type="button" onClick={onClose} aria-label="Close place search"><X size={17} /></button>}</form><div className="place-results" role="status">{state === "loading" && "Searching…"}{state === "empty" && "No places found."}{state === "error" && error}{results.map((item, index) => <button type="button" key={`${item.displayName}:${index}`} onClick={() => { onVisit(item.destination); onClose(); }}>{item.displayName}</button>)}</div></>;
}

export default function PlaceSearch({ open, onOpen, onClose, onVisit, globeRef }) {
  const phone=usePhoneUI();
  const [query, setQuery] = useState("");
  const trigger=useRef(null);
  function close(){onClose();requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));}
  if(phone&&open)return <WorkspaceDialog className="hud-panel phone-workspace place-search-workspace" aria-labelledby="place-search-title" onClose={close}>
    <header className="hud-panel__header"><h2 id="place-search-title">Search a place or address</h2><button type="button" className="icon-button" aria-label="Close place search" onClick={close}><X size={20}/></button></header>
    <div className="hud-panel__body"><SearchForm phone query={query} setQuery={setQuery} onClose={close} onVisit={onVisit} globeRef={globeRef}/></div>
  </WorkspaceDialog>;
  return <div className="place-search">{open
    ? <SearchForm query={query} setQuery={setQuery} onClose={close} onVisit={onVisit} globeRef={globeRef} />
    : <button ref={trigger} type="button" onClick={onOpen} title="Search a place or address" aria-label="Search a place or address"><Search size={17} /></button>}
  </div>;
}
