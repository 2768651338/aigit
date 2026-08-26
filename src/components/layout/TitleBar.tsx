import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { useRepoStore } from "@/stores/repoStore";
import { pathLeaf } from "@/utils/path";
import {
  MinusIcon,
  RestoreIcon,
  SquareIcon,
  XIcon,
} from "@/components/common/Icons";

/**
 * Resolve the Tauri window handle once. Returns null when the frontend runs
 * outside the Tauri runtime (plain-browser dev server, unit tests) so the
 * title bar degrades to a static strip instead of crashing.
 */
function resolveTauriWindow(): TauriWindow | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

const CAPTION_BTN =
  "w-11 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors active:!transform-none";

export function TitleBar() {
  const { t } = useTranslation();
  const win = useMemo(resolveTauriWindow, []);
  const activePath = useRepoStore((s) => s.activePath);
  const [maximized, setMaximized] = useState(false);

  // Track maximized state so the middle caption button can switch between
  // the maximize and restore icons. Resize events are the only reliable
  // signal on all platforms (there is no dedicated maximize event).
  useEffect(() => {
    if (!win) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const initial = await win.isMaximized();
        const off = await win.onResized(async () => {
          try {
            setMaximized(await win.isMaximized());
          } catch {
            // Window closed mid-flight; the cleanup below stops the listener.
          }
        });
        if (cancelled) {
          off();
        } else {
          unlisten = off;
          setMaximized(initial);
        }
      } catch {
        // Webview not attached to a real window; leave defaults.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [win]);

  const title = activePath ? `${pathLeaf(activePath)} — aigit` : "aigit";

  return (
    <header className="flex items-stretch h-10 shrink-0 select-none">
      {/* Brand segment — visually continues the sidebar below it */}
      <div className="flex items-center w-64 shrink-0 px-4 bg-bg-surface border-r border-border">
        <span className="font-semibold text-sm tracking-tight">aigit</span>
      </div>

      {/* Draggable region with centered window title. Double-click toggles
          maximize (handled natively for data-tauri-drag-region targets). */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 bg-bg-base"
        data-tauri-drag-region
      >
        <span
          className="max-w-[60%] truncate text-xs text-text-secondary"
          data-tauri-drag-region
          title={title}
        >
          {title}
        </span>
      </div>

      {/* Windows-style caption buttons. Hidden outside Tauri where they
          would have nothing to control. */}
      {win && (
        <div className="flex items-stretch shrink-0">
          <button
            type="button"
            className={CAPTION_BTN}
            onClick={() => void win.minimize()}
            title={t("titleBar.minimize")}
            aria-label={t("titleBar.minimize")}
          >
            <MinusIcon size={14} />
          </button>
          <button
            type="button"
            className={CAPTION_BTN}
            onClick={() => void win.toggleMaximize()}
            title={t(maximized ? "titleBar.restore" : "titleBar.maximize")}
            aria-label={t(maximized ? "titleBar.restore" : "titleBar.maximize")}
          >
            {maximized ? <RestoreIcon size={13} /> : <SquareIcon size={12} />}
          </button>
          <button
            type="button"
            className={`${CAPTION_BTN} w-12 hover:bg-danger hover:text-white`}
            onClick={() => void win.close()}
            title={t("titleBar.close")}
            aria-label={t("titleBar.close")}
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
