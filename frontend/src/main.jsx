import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthRoot from "./auth/AuthRoot.jsx";
import "./styles.css";
import "cesium/Build/Cesium/Widgets/widgets.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthRoot />
  </StrictMode>,
);
