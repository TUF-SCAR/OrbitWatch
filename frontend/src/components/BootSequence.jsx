import { useReducedMotionPreference } from "../utils/useReducedMotion.js";
import { motion } from "motion/react";
import { Orbit } from "lucide-react";
import "./BootSequence.css";

export default function BootSequence({ preparingLive = false }) {
  const reduced = useReducedMotionPreference();
  return (
    <motion.div
      className="boot-sequence" role="status" aria-label={preparingLive ? "Restoring your session" : "Starting OrbitWatch"}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: reduced ? "none" : "blur(12px)" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="boot-sequence__system" aria-hidden="true">
        <motion.span
          className="boot-sequence__ring boot-sequence__ring--outer"
          animate={{ rotate: reduced ? 0 : 360 }}
          transition={{ duration: 4.8, repeat: Infinity, ease: "linear" }}
        />
        <motion.span
          className="boot-sequence__ring boot-sequence__ring--inner"
          animate={{ rotate: reduced ? 0 : -360 }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
        />
        <span className="boot-sequence__core">
          <Orbit size={24} />
        </span>
      </div>

      <motion.div
        className="boot-sequence__copy"
        initial={{ opacity: 0, y: 9 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, delay: 0.08 }}
      >
        <strong>ORBITWATCH</strong>
        <span>
          {preparingLive ? "PREPARING LIVE EARTH" : "INITIALIZING SPATIAL SYSTEM"}
        </span>
      </motion.div>

      <div className="boot-sequence__progress" aria-hidden="true">
        <motion.span
          animate={{ opacity: reduced ? 1 : [0.25, 1, 0.25] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      </div>
    </motion.div>
  );
}
