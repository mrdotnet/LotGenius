import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createExplorerSource } from "./data/source";
import "./styles.css";

// The adapter seam picks fixture (default) or live from build-time env.
const source = createExplorerSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
);
