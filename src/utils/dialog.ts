import { message as tauriMessage, confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { isTauriEnv } from "./env";
import i18n from "@/i18n";

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

/**
 * Show a Yes/No confirmation dialog.
 *
 * Returns true if the user confirmed (Yes/OK), false otherwise.
 * Uses the Tauri dialog `confirm` helper inside the WebView, and
 * falls back to the browser `confirm` primitive elsewhere.
 *
 * Use this before destructive operations (discard changes, delete
 * branch, force push, etc.) to give the user a chance to cancel.
 */
export async function confirmDialog(
  title: string,
  message: string,
  kind: DialogKind = "warning"
): Promise<boolean> {
  if (isTauriEnv()) {
    try {
      const confirmed = await tauriConfirm(message, {
        title,
        kind: toTauriKind(kind),
        okLabel: i18n.t("common.ok"),
        cancelLabel: i18n.t("common.cancel"),
      });
      return confirmed;
    } catch (e) {
      console.warn("[aigit] Tauri confirm unavailable, falling back to confirm():", e);
    }
  }
  return window.confirm(`${title}\n\n${message}`);
}

