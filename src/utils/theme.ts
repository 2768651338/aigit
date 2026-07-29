export type ThemeMode = "light" | "dark" | "system";

let mediaQuery: MediaQueryList | null = null;
let changeHandler: (() => void) | null = null;

/**
 * Apply the given theme mode to the document root.
 * - "light": force light theme
 * - "dark": force dark theme
 * - "system": follow the OS prefers-color-scheme, updating live on change
 *
 * Idempotent: safe to call repeatedly. Cleans up the previous system
 * listener before registering a new one so only one is ever active.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;

  // Remove the previous system-mode listener (if any)
  if (mediaQuery && changeHandler) {
    mediaQuery.removeEventListener("change", changeHandler);
    changeHandler = null;
  }

  const update = () => {
    let isLight: boolean;
    if (mode === "light") {
      isLight = true;
    } else if (mode === "dark") {
      isLight = false;
    } else {
      isLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    }
    root.classList.toggle("theme-light", isLight);
  };

  update();

  // For system mode, keep the listener so theme tracks OS changes live.
  if (mode === "system") {
    mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    changeHandler = update;
    mediaQuery.addEventListener("change", changeHandler);
  }
}
