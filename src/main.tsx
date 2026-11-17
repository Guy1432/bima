// dev-only: render the operator UI in a plain browser (see lib/devmock.ts). Must be first.
import "./lib/devmock";
import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./lib/fonts";
import "./index.css";
import { initMediaDir } from "./lib/media";
import { OperatorApp } from "./operator/OperatorApp";
import { ProjectorApp } from "./projector/ProjectorApp";
import { ErrorBoundary } from "./components/ErrorBoundary";

const label = getCurrentWindow().label;
const isProjector = label === "projector";

// block browser-ish behaviour that makes no sense in a desktop app
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

initMediaDir().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary silent={isProjector}>{isProjector ? <ProjectorApp /> : <OperatorApp />}</ErrorBoundary>
    </React.StrictMode>,
  );
});
