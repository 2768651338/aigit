import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// The window disables Tauri's native drag-drop handler (dragDropEnabled:
// false) so HTML5 drag-and-drop works inside the UI. That restores the
// WebView's default behavior of navigating to an externally dropped file,
// which would wipe the app state — swallow all drag events at the document
// level instead; feature-level drop zones call preventDefault() themselves.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
