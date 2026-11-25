import { useReducedMotionPreference } from "../utils/useReducedMotion.js";
import { AnimatePresence, motion } from "motion/react";
import { panelMotion } from "../utils/motionTokens.js";
import { AU_METERS } from "../data/solarSystemEphemeris.js";

export default function SystemScaleSlider({ scale, onChange, onOortToggle }) {
  const reduced = useReducedMotionPreference();
  const au = scale.range / AU_METERS;
  const distance = scale.oortActive ? `${Math.round(au).toLocaleString()} AU` : au >= .01 ? `${au.toFixed(2)} AU` : `${Math.round(scale.range / 1000).toLocaleString()} km`;
  return <AnimatePresence>{scale.visible && <motion.aside key="scale" className="system-scale" aria-label="System scale control" {...panelMotion(reduced)}>
    <div className="system-scale__heading"><label htmlFor="system-scale-range">{scale.oortActive ? "OORT CLOUD" : "SCENE SCALE"}</label><output htmlFor="system-scale-range">{distance}</output></div>
    <input id="system-scale-range" type="range" min="0" max="1" step="0.001" value={scale.value} disabled={scale.oortTransition} aria-label={scale.oortActive ? "Oort Cloud zoom" : "System-scale zoom"} aria-valuetext={distance} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="system-scale__ends"><span>{scale.oortActive ? "INNER CLOUD" : "LOCAL"}</span><span>{scale.oortActive ? "OUTER VIEW" : "SOLAR SYSTEM"}</span></div>
    {scale.oortActive && <p className="system-scale__population">Illustrative cloud · estimated 5,000–100,000 AU. Individual positions unobserved.</p>}
    {!scale.oortActive && scale.populationContext && <div className="system-scale__population" title={`Representative distributions: ${scale.populationContext}. These dots are not individually catalogued bodies.`}>Representative procedural population</div>}
    {(scale.oortAvailable || scale.oortActive) && <button type="button" className="secondary-action system-scale__oort" disabled={scale.oortTransition} onClick={onOortToggle}>{scale.oortActive ? "Return to Solar System" : "Explore Oort Cloud"}</button>}
  </motion.aside>}</AnimatePresence>;
}
