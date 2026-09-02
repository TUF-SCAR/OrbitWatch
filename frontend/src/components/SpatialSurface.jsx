import { useRef } from "react";

const SIDE_BASE = {
  left: { rx: -1.2, ry: 3.8 },
  right: { rx: -1.2, ry: -3.8 },
  top: { rx: 2.4, ry: 0 },
  bottom: { rx: -3.0, ry: 0 },
  center: { rx: 0, ry: 0 },
};

export default function SpatialSurface({
  as: Tag = "div",
  side = "center",
  strength = 5,
  className = "",
  children,
  onPointerMove,
  onPointerLeave,
  ...props
}) {
  const ref = useRef(null);
  const base = SIDE_BASE[side] || SIDE_BASE.center;

  function handlePointerMove(event) {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const ny = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;

    node.style.setProperty("--pointer-rx", `${(-ny * strength).toFixed(2)}deg`);
    node.style.setProperty("--pointer-ry", `${(nx * strength).toFixed(2)}deg`);
    node.style.setProperty("--pointer-x", `${((nx + 1) * 50).toFixed(1)}%`);
    node.style.setProperty("--pointer-y", `${((ny + 1) * 50).toFixed(1)}%`);
    node.classList.add("is-pointer-active");
    onPointerMove?.(event);
  }

  function handlePointerLeave(event) {
    const node = ref.current;
    if (node) {
      node.style.setProperty("--pointer-rx", "0deg");
      node.style.setProperty("--pointer-ry", "0deg");
      node.style.setProperty("--pointer-x", "50%");
      node.style.setProperty("--pointer-y", "50%");
      node.classList.remove("is-pointer-active");
    }
    onPointerLeave?.(event);
  }

  return (
    <Tag
      ref={ref}
      className={`spatial-surface spatial-surface--${side} ${className}`.trim()}
      style={{
        "--base-rx": `${base.rx}deg`,
        "--base-ry": `${base.ry}deg`,
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      {children}
    </Tag>
  );
}
