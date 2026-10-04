// Development-only control for exercising JavaScript media-query listeners.
// CSS media queries still use the OS preference; this is not CSS emulation.
export function instrumentMotionPreference() {
  const original = window.matchMedia;
  const queries = new Set();
  let preference = "system";
  window.matchMedia = function (query) {
    const media = original.call(window, query);
    if (!/^\(prefers-reduced-motion(?::\s*reduce)?\)$/.test(query.trim())) return media;
    Object.defineProperty(media, "matches", {
      configurable: true,
      get: () => preference === "system" ? original.call(window, query).matches : preference === "reduce",
    });
    queries.add(media);
    return media;
  };
  return {
    set(value) {
      if (!["system", "reduce", "full"].includes(value) || preference === value) return;
      preference = value;
      for (const media of queries) media.dispatchEvent(new MediaQueryListEvent("change", { media: media.media, matches: media.matches }));
    },
    dispose() {
      window.matchMedia = original;
      for (const media of queries) delete media.matches;
      queries.clear();
    },
  };
}
