import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

function SearchForm({ query, setQuery, onClose, onVisit, globeRef }) {
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
  return <><form onSubmit={search}><label><span className="sr-only">Place or address</span><input autoFocus value={query} onChange={changeQuery} placeholder="Place or address" /></label><button type="submit" aria-label="Search places" disabled={state === "loading" || !query.trim()}><Search size={17} /></button><button type="button" onClick={onClose} aria-label="Close place search"><X size={17} /></button></form><div className="place-results" role="status">{state === "loading" && "Searching…"}{state === "empty" && "No places found."}{state === "error" && error}{results.map((item, index) => <button type="button" key={`${item.displayName}:${index}`} onClick={() => { onVisit(item.destination); onClose(); }}>{item.displayName}</button>)}</div></>;
}

export default function PlaceSearch({ open, onOpen, onClose, onVisit, globeRef }) {
  const [query, setQuery] = useState("");
  return <div className="place-search">{open
    ? <SearchForm query={query} setQuery={setQuery} onClose={onClose} onVisit={onVisit} globeRef={globeRef} />
    : <button type="button" onClick={onOpen} title="Search a place or address" aria-label="Search a place or address"><Search size={17} /></button>}
  </div>;
}
