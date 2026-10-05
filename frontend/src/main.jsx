import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { MOTION, HUD_EASE } from "./utils/motionTokens.js";
import AuthRoot from "./auth/AuthRoot.jsx";
import "./styles.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./live.css";

createRoot(document.getElementById("root")).render(
  <MotionConfig reducedMotion="user" transition={{ duration: MOTION.panel, ease: HUD_EASE }}><AuthRoot /></MotionConfig>,
);
