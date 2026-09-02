import { motion } from "motion/react";
import "./LiquidGlass.css";

function numberFromText(text) {
  let number = 0;

  for (let index = 0; index < text.length; index += 1) {
    number += text.charCodeAt(index) * (index + 1);
  }

  return number;
}

function flowValuesFromClassName(className) {
  const flowNumber = numberFromText(className || "liquid-glass");
  const direction1 = flowNumber % 2 === 0 ? 1 : -1;
  const direction2 = flowNumber % 3 === 0 ? 1 : -1;

  return {
    "--glass-drift-x": `${direction1 * (1 + (flowNumber % 3))}px`,
    "--glass-drift-y": `${direction2 * (1 + ((flowNumber >> 2) % 3))}px`,
    "--glass-drift-duration": `${20 + (flowNumber % 10)}s`,
    "--glass-flow-duration-1": `${18 + (flowNumber % 9)}s`,
    "--glass-flow-duration-2": `${23 + (flowNumber % 11)}s`,
    "--glass-flow-delay": `${-(flowNumber % 17)}s`,
    "--glass-flow-x-1": `${direction1 * (28 + (flowNumber % 24))}%`,
    "--glass-flow-y-1": `${direction2 * (20 + ((flowNumber >> 2) % 26))}%`,
    "--glass-flow-x-2": `${direction2 * (24 + ((flowNumber >> 1) % 28))}%`,
    "--glass-flow-y-2": `${direction1 * (18 + ((flowNumber >> 3) % 24))}%`,
  };
}

function updatePointerLight(event) {
  const glassElement = event.currentTarget;
  const glassBounds = glassElement.getBoundingClientRect();
  const pointerX = ((event.clientX - glassBounds.left) / glassBounds.width) * 100;
  const pointerY = ((event.clientY - glassBounds.top) / glassBounds.height) * 100;

  glassElement.style.setProperty("--glass-pointer-x", `${pointerX}%`);
  glassElement.style.setProperty("--glass-pointer-y", `${pointerY}%`);
  glassElement.style.setProperty("--glass-pointer-opacity", "0.075");
}

function softenPointerLight(event) {
  event.currentTarget.style.setProperty("--glass-pointer-opacity", "0.018");
}

function LiquidGlass({
  children,
  className = "",
  element = "div",
  strength = "medium",
  onPointerMove,
  onPointerLeave,
  style,
  ...motionProperties
}) {
  const MotionElement = element === "button" ? motion.button : motion.div;
  const glassClassName = [
    "liquid-glass",
    `liquid-glass--${strength}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  function handlePointerMove(event) {
    updatePointerLight(event);
    onPointerMove?.(event);
  }

  function handlePointerLeave(event) {
    softenPointerLight(event);
    onPointerLeave?.(event);
  }

  return (
    <MotionElement
      className={glassClassName}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      style={{
        ...flowValuesFromClassName(className),
        ...style,
      }}
      {...motionProperties}
    >
      <span className="liquid-glass__flow liquid-glass__flow--1" />
      <span className="liquid-glass__flow liquid-glass__flow--2" />
      <span className="liquid-glass__caustic" />
      <span className="liquid-glass__pointer-light" />
      <span className="liquid-glass__edge" />
      {children}
    </MotionElement>
  );
}

export default LiquidGlass;
