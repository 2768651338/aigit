/**
 * Detect whether the app is running inside a Tauri WebView.
 * In a plain browser (e.g. `vite dev` without Tauri), Tauri IPC is unavailable
 * and all `invoke()` calls would fail silently.
 */
export function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 injects this internal object
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}
