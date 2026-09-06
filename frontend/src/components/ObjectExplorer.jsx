import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, RotateCcw, Search, Star, X } from "lucide-react";
import SpatialSurface from "./SpatialSurface.jsx";

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export default function ObjectExplorer({
  open,
  onClose,
  objects,
  trackedIds,
  selectedId,
  onSelect,
  onApplyTrackedIds,
  maxTracked,
  limitMessage,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [draftTrackedIds, setDraftTrackedIds] = useState(() => new Set(trackedIds));
  const [selectionMessage, setSelectionMessage] = useState("");

  const objectList = Array.isArray(objects) ? objects : [];
  const trackedSet = useMemo(() => new Set(trackedIds), [trackedIds]);
  const hasChanges = !setsEqual(draftTrackedIds, trackedSet);

  const categories = useMemo(() => {
    const found = new Set(
      objectList
        .map((item) => item.category)
        .filter(Boolean),
    );
    return ["All", ...found];
  }, [objectList]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return objectList.filter((item) => {
      const categoryMatch = category === "All" || item.category === category;
      const textMatch =
        !normalized ||
        `${item.name} ${item.noradId} ${item.operator || ""}`
          .toLowerCase()
          .includes(normalized);
      return categoryMatch && textMatch;
    });
  }, [objectList, query, category]);

  useEffect(() => {
    if (!open) return;
    setDraftTrackedIds(new Set(trackedIds));
    setSelectionMessage("");
  }, [open, trackedIds]);

  useEffect(() => {
    if (!categories.includes(category)) setCategory("All");
  }, [categories, category]);

  function toggleDraft(noradId) {
    setDraftTrackedIds((ids) => {
      const next = new Set(ids);

      if (next.has(noradId)) {
        next.delete(noradId);
        setSelectionMessage("");
        return next;
      }

      if (maxTracked && next.size >= maxTracked) {
        setSelectionMessage(
          `Time Explorer can display up to ${maxTracked} objects at once.`,
        );
        return ids;
      }

      next.add(noradId);
      setSelectionMessage("");
      return next;
    });
  }

  function selectVisible() {
    setDraftTrackedIds((ids) => {
      const next = new Set(ids);
      let capped = false;

      for (const item of filtered) {
        if (next.has(item.noradId)) continue;
        if (maxTracked && next.size >= maxTracked) {
          capped = true;
          break;
        }
        next.add(item.noradId);
      }

      setSelectionMessage(
        capped
          ? `Selected the first ${maxTracked} objects allowed in Time Explorer.`
          : "",
      );
      return next;
    });
  }

  function clearVisible() {
    const visibleIds = new Set(filtered.map((item) => item.noradId));
    setDraftTrackedIds((ids) => {
      const next = new Set(ids);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
    setSelectionMessage("");
  }

  function resetDraft() {
    setDraftTrackedIds(new Set(trackedIds));
    setSelectionMessage("");
  }

  function applyDraft() {
    const applied = onApplyTrackedIds?.([...draftTrackedIds]);
    if (applied !== false) setSelectionMessage("Selection applied to globe.");
  }

  if (!open) return null;

  return (
    <SpatialSurface
      as="aside"
      side="left"
      strength={4.7}
      className="object-explorer"
      aria-label="Object explorer"
    >
      <div className="object-explorer__head" data-depth="3">
        <div>
          <div className="eyebrow">CATALOGUE / {objectList.length} OBJECTS</div>
          <h2>Object Explorer</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close object explorer"
        >
          <X size={18} />
        </button>
      </div>

      <label className="search-field" data-depth="5">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, NORAD or operator"
          autoFocus
        />
      </label>

      <div className="category-strip" data-depth="4">
        {categories.map((item) => (
          <button
            key={item}
            onClick={() => setCategory(item)}
            className={category === item ? "is-active" : ""}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="selection-toolbar" data-depth="4">
        <div>
          <strong>{draftTrackedIds.size}</strong>
          <span>{maxTracked ? ` / ${maxTracked}` : ""} selected for globe</span>
        </div>
        <button onClick={selectVisible}>SELECT VISIBLE</button>
        <button onClick={clearVisible}>CLEAR VISIBLE</button>
      </div>

      {(limitMessage || selectionMessage) && (
        <div className="limit-message" data-depth="6">
          {limitMessage || selectionMessage}
        </div>
      )}

      <div className="object-list" data-depth="6">
        {filtered.map((item) => {
          const inDraft = draftTrackedIds.has(item.noradId);
          const currentlyTracked = trackedSet.has(item.noradId);

          return (
            <div
              key={item.noradId}
              className={[
                "object-row",
                selectedId === item.noradId ? "is-selected" : "",
                inDraft ? "is-draft-tracked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                className="object-row__main"
                onClick={() => onSelect(item.noradId)}
                title="Open object overview"
              >
                <span
                  className={`object-dot object-dot--${String(item.category || "other")
                    .toLowerCase()
                    .replace(/\s+/g, "-")}`}
                />
                <span className="object-row__copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.category || "Other"} · NORAD {item.noradId}
                    {currentlyTracked ? " · LOADED" : ""}
                  </small>
                </span>
                {item.featured && (
                  <Star className="object-row__star" size={13} fill="currentColor" />
                )}
                <ChevronRight size={15} />
              </button>

              <button
                className={`track-checkbox ${inDraft ? "is-active" : ""}`}
                onClick={() => toggleDraft(item.noradId)}
                title={inDraft ? "Remove from globe selection" : "Add to globe selection"}
                aria-label={inDraft ? `Remove ${item.name}` : `Add ${item.name}`}
              >
                {inDraft ? <Check size={15} /> : <span />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="selection-actions" data-depth="4">
        <button
          className="selection-actions__reset"
          onClick={resetDraft}
          disabled={!hasChanges}
          title="Discard selection changes"
        >
          <RotateCcw size={14} /> RESET
        </button>
        <button
          className="selection-actions__apply"
          onClick={applyDraft}
          disabled={!hasChanges}
        >
          APPLY {draftTrackedIds.size} OBJECTS
        </button>
      </div>

      <div className="object-explorer__foot" data-depth="3">
        <span>{filtered.length} results</span>
        <span>{trackedIds.length}{maxTracked ? ` / ${maxTracked}` : ""} loaded</span>
      </div>
    </SpatialSurface>
  );
}
