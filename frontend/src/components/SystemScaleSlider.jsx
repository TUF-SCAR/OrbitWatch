import { useReducedMotionPreference } from "../utils/useReducedMotion.js";
import { AnimatePresence, motion } from "motion/react";
import { panelMotion } from "../utils/motionTokens.js";
import { AU_METERS } from "../data/solarSystemEphemeris.js";

export default function SystemScaleSlider({ scale, onChange }) {
  const reduced = useReducedMotionPreference();
  const distance = scale.range >= AU_METERS * 0.01 ? `${(scale.range / AU_METERS).toFixed(2)} AU` : `${Math.round(scale.range / 1000).toLocaleString()} km`;
  return <AnimatePresence>{scale.visible && <motion.aside key="scale" className="system-scale" aria-label="System scale control" {...panelMotion(reduced)}>
    <div className="system-scale__heading"><label htmlFor="system-scale-range">SCENE SCALE</label><output htmlFor="system-scale-range">{distance}</output></div>
    <input id="system-scale-range" type="range" min="0" max="1" step="0.001" value={scale.value} aria-label="System-scale zoom" aria-valuetext={distance} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="system-scale__ends"><span>LOCAL</span><span>SOLAR SYSTEM</span></div>
  </motion.aside>}</AnimatePresence>;
}
