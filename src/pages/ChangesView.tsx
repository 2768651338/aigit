import { useRepoStore } from "@/stores/repoStore";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { FileStatusList } from "@/components/git/FileStatusList";
import { DiffViewer } from "@/components/git/DiffViewer";
import { CommitPanel } from "@/components/git/CommitPanel";
import { RefreshIcon, AlertCircleIcon, SpinnerIcon, FolderIcon } from "@/components/common/Icons";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { useToastStore } from "@/stores/toastStore";

/** localStorage key for the resizable commit panel height (px). */
const COMMIT_PANEL_HEIGHT_KEY = "aigit:commitPanelHeight";
const COMMIT_PANEL_DEFAULT_HEIGHT = 288; // matches the original h-72 (18rem)
const COMMIT_PANEL_MIN_HEIGHT = 160; // keep controls + a usable textarea visible
const COMMIT_PANEL_MIN_LIST_HEIGHT = 80; // always leave some room for the file list above

/** Read the persisted commit panel height, falling back to the default. */
function loadPanelHeight(): number {
  try {
    const raw = localStorage.getItem(COMMIT_PANEL_HEIGHT_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= COMMIT_PANEL_MIN_HEIGHT) return n;
    }
  } catch {
    // best-effort — ignore parse/quota errors
  }
  return COMMIT_PANEL_DEFAULT_HEIGHT;
}

export function ChangesView() {
  const { t } = useTranslation();
  const {
    currentPath,
    selectedFile,
    workdirDiff,
    stagedDiff,
    refreshStatus,
    refreshing,
    error,
    clearError,
  } = useRepoStore();

  useEffect(() => {
    if (currentPath) {
      const interval = setInterval(refreshStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [currentPath, refreshStatus]);

  // --- Resizable commit panel ---
  // The commit panel lives at the bottom of the left column and its textarea
  // fills the panel's leftover space, so resizing the panel resizes the
  // commit message input. The height is persisted to localStorage.
  const [panelHeight, setPanelHeight] = useState<number>(loadPanelHeight);
  const [isResizing, setIsResizing] = useState(false);
  const dragInfo = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const colHeight = panel.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    dragInfo.current = {
      startY: e.clientY,
      startHeight: panel.offsetHeight,
      // Cap growth so the file list above keeps at least a minimum height.
      maxHeight: Math.max(COMMIT_PANEL_MIN_HEIGHT, colHeight - COMMIT_PANEL_MIN_LIST_HEIGHT),
    };
    setIsResizing(true);
  };

  // Attach window-level listeners only while a drag is active, so the handle
  // keeps tracking the cursor even outside itself and cleans up on mouseup.
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const info = dragInfo.current;
      if (!info) return;
      // The handle sits at the top of the panel: dragging it up grows the panel.
      const delta = info.startY - e.clientY;
      const next = Math.max(
        COMMIT_PANEL_MIN_HEIGHT,
        Math.min(info.maxHeight, info.startHeight + delta),
      );
      setPanelHeight(next);
    };
    const onUp = () => {
      setIsResizing(false);
      dragInfo.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Persist the height (best-effort) whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(COMMIT_PANEL_HEIGHT_KEY, String(panelHeight));
    } catch {
      // ignore quota errors
    }
  }, [panelHeight]);

  // If the window shrinks after a tall height was persisted, clamp the panel
  // back down so the file list and actions stay visible.
  useEffect(() => {
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const colHeight = panel.parentElement?.getBoundingClientRect().height;
      if (!colHeight) return;
      const max = Math.max(COMMIT_PANEL_MIN_HEIGHT, colHeight - COMMIT_PANEL_MIN_LIST_HEIGHT);
      setPanelHeight((h) => (h > max ? max : h));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resetPanelHeight = () => setPanelHeight(COMMIT_PANEL_DEFAULT_HEIGHT);

  if (!currentPath) {
    return <NoRepoOpen />;
  }

  const showDiff = selectedFile ? [...stagedDiff, ...workdirDiff] : [];

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 text-danger text-sm border-b border-danger/20">
          <AlertCircleIcon size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center px-5 h-12 border-b border-border">
        <h2 className="text-base font-semibold">{t("changes.title")}</h2>
        <div className="flex-1" />
        <button
          onClick={() => refreshStatus()}
          disabled={refreshing}
          className="btn-ghost"
          aria-label={t("changes.refresh")}
        >
          {refreshing ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
          {t("changes.refresh")}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: File lists + commit */}
        <div
          className={clsx(
            "flex flex-col overflow-hidden",
            selectedFile ? "w-96 border-r border-border" : "flex-1"
          )}
        >
          {/* Staged section */}
          <div className="flex-1 overflow-auto">
            <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("changes.stagedChanges")}
            </div>
            <div className="px-3 pb-3">
              <FileStatusList staged={true} />
            </div>

            <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted border-t border-border-subtle">
              {t("changes.changes")}
            </div>
            <div className="px-3 pb-3">
              <FileStatusList staged={false} />
            </div>
          </div>

          {/* Commit panel — height is user-resizable via the top handle */}
          <div
            ref={panelRef}
            className="shrink-0 flex flex-col"
            style={{ height: panelHeight }}
          >
            <div
              onMouseDown={handleResizeStart}
              onDoubleClick={resetPanelHeight}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("commit.dragToResize")}
              title={t("commit.dragToResize")}
              className="h-1.5 shrink-0 cursor-row-resize flex items-center justify-center group border-t border-border hover:bg-accent/10"
            >
              <div className="h-0.5 w-10 rounded-full bg-border-strong group-hover:bg-accent transition-colors" />
            </div>
            <div className="flex-1 min-h-0">
              <CommitPanel />
            </div>
          </div>
        </div>

        {/* Right: Diff viewer — only when a file is selected */}
        {selectedFile && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center px-5 h-12 border-b border-border">
              <span className="text-sm font-medium text-text-primary truncate">
                {selectedFile}
              </span>
            </div>
            <div className="flex-1 overflow-auto">
              <DiffViewer diffs={showDiff} className="h-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoRepoOpen() {
  const { t } = useTranslation();
  const openRepo = useRepoStore((s) => s.openRepo);
  const toast = useToastStore();
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;
      const repoPath = await gitService.discoverRepo(selected);
      await openRepo(repoPath);
    } catch (e) {
      console.error("[aigit] Open repo failed:", e);
      toast.error(formatError(e), t("tabs.openFailed"));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-bg-surface border border-border flex items-center justify-center mb-4">
        <FolderIcon size={32} className="text-text-muted" />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-1">{t("changes.noRepoTitle")}</h2>
      <p className="text-sm text-text-secondary max-w-sm mb-5">
        {t("changes.noRepoDesc")}
      </p>
      <button onClick={handleOpen} disabled={opening} className="btn-primary">
        {opening ? <SpinnerIcon size={14} /> : <FolderIcon size={14} />}
        {t("changes.openRepo")}
      </button>
    </div>
  );
}
