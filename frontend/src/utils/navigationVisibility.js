// One policy for rendered controls, panel entry points and keyboard shortcuts.
export function navigationVisibility(mode, atEarth) {
  const live = mode === "live";
  return {
    modeRail: atEarth,
    map: atEarth && (live || mode === "time"),
    camera: atEarth && live,
    system: live,
    explorer: atEarth && (live || mode === "time"),
    place: atEarth,
  };
}
