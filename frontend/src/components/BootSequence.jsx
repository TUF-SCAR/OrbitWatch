import { motion } from "motion/react";
import { Orbit } from "lucide-react";
import "./BootSequence.css";

export default function BootSequence({ preparingLive = false }) {
  return (
    <motion.div
      className="boot-sequence"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(12px)" }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="boot-sequence__system" aria-hidden="true">
        <motion.span
          className="boot-sequence__ring boot-sequence__ring--outer"
          animate={{ rotate: 360 }}
          transition={{ duration: 4.8, repeat: Infinity, ease: "linear" }}
        />
        <motion.span
          className="boot-sequence__ring boot-sequence__ring--inner"
          animate={{ rotate: -360 }}
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

      <div className="boot-sequence__checks">
        <motion.span
          initial={{ opacity: 0.25 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.18 }}
        >
          <i /> INTERFACE MODULES
        </motion.span>
        <motion.span
          initial={{ opacity: 0.25 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.42 }}
        >
          <i /> CESIUM RENDERER
        </motion.span>
        <motion.span
          initial={{ opacity: 0.25 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.68 }}
        >
          <i /> ORBITWATCH SERVICES
        </motion.span>
      </div>

      <div className="boot-sequence__progress">
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: preparingLive ? 2.4 : 2.05, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  );
}
