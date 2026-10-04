import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import AuthRoot from "./auth/AuthRoot.jsx";
import "./styles.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./live.css";

createRoot(document.getElementById("root")).render(
  <MotionConfig reducedMotion="user"><AuthRoot /></MotionConfig>,
);
