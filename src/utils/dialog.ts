import { message as tauriMessage } from "@tauri-apps/plugin-dialog";
import { isTauriEnv } from "./env";

export type DialogKind = "info" | "success" | "warning" | "error";

// Tauri dialog plugin only supports info / warning / error.
// We map our "success" kind to "info" with a success-styled title.
type TauriDialogKind = "info" | "warning" | "error";

function toTauriKind(kind: DialogKind): TauriDialogKind {
  return kind === "success" ? "info" : kind;
}

/**
 * Show a modal message dialog.
 *
 * Uses the Tauri dialog plugin when running inside the Tauri WebView,
 * and falls back to the browser `alert` primitive when running in a
 * plain browser (e.g. `vite dev` without Tauri), so the caller does
 * not need to care about the environment.
 *
 * The native dialog is non-blocking (returns a Promise) and is the
 * preferred UX for one-shot notifications like "push succeeded".
 */
export async function showMessage(
  title: string,
  message: string,
  kind: DialogKind = "info"
): Promise<void> {
  if (isTauriEnv()) {
    try {
      await tauriMessage(message, { title, kind: toTauriKind(kind) });
      return;
    } catch (e) {
      console.warn("[aigit] Tauri dialog unavailable, falling back to alert:", e);
    }
  }
  // Browser fallback — alert is blocking and ignores `kind`.
  const prefix = kind === "error" ? "❌ " : kind === "warning" ? "⚠ " : kind === "success" ? "✓ " : "";
  alert(`${prefix}${title}\n\n${message}`);
}
