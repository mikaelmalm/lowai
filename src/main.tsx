import "@fontsource-variable/inter/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { fullscreenKeepsRoundedCorners } from "./theme/chrome";

if (fullscreenKeepsRoundedCorners(navigator.platform)) document.documentElement.classList.add("os-macos");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
