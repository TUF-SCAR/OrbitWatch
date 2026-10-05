// Only nearby deterministic slots. Preserve a valid prior slot while the
// camera moves; hide a lower priority name rather than displacing it far away.
export const LABEL_OFFSETS = [[0, -19], [0, 19], [30, -19], [-30, -19], [30, 19], [-30, 19]];
export function layoutCelestialLabels(candidates, width, height, previous = new Map()) {
  const result = new Map(), occupied = [];
  for (const item of [...candidates].sort((a, b) => a.priority - b.priority || a.order - b.order)) {
    const old = previous.get(item.id);
    const slots = old ? [old, ...LABEL_OFFSETS.filter((slot) => slot[0] !== old[0] || slot[1] !== old[1])] : LABEL_OFFSETS;
    for (const offset of slots) {
      const x = item.x + offset[0], y = item.y + offset[1], half = item.name.length * 4.2 + 4;
      const box = { left: x - half, right: x + half, top: y - 9, bottom: y + 9 };
      if (box.left < 8 || box.right > width - 8 || box.top < 80 || box.bottom > height - 105) continue;
      // New slots need clearance; retained slots have a smaller margin. Tiny
      // changes at the collision boundary cannot alternate the label's slot.
      const padding = offset === old ? 3 : 8;
      if (occupied.some((other) => box.left < other.right + padding && box.right > other.left - padding && box.top < other.bottom + padding && box.bottom > other.top - padding)) continue;
      occupied.push(box); result.set(item.id, offset); break;
    }
  }
  return result;
}
