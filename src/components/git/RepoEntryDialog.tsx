import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { formatError } from "@/utils/error";
import { useModalAccessibility } from "@/utils/modalA11y";
import {
  AlertCircleIcon,
  DownloadIcon,
  FolderIcon,
  GitBranchIcon,
  SpinnerIcon,
  XIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

type RepoEntryMode = "open" | "clone" | "init";

interface RepoEntryContextValue {
  showRepoEntry: (mode?: RepoEntryMode) => void;
}

const RepoEntryContext = createContext<RepoEntryContextValue | null>(null);

export function isCloneUrlValid(value: string): boolean {
  const url = value.trim();
  if (!url || /[\r\n\0]/.test(url)) return false;
  // Mirrors the backend whitelist: https/ssh transports only — no http, git
  // protocol or local paths.
  if (/^(https|ssh):\/\/[^\s]+$/i.test(url)) return true;
  return /^[^\s@]+@[^\s:]+:[^\s]+$/.test(url);
}

export function isAbsoluteDirectory(value: string): boolean {
  const path = value.trim();
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

export function RepoEntryProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [initialMode, setInitialMode] = useState<RepoEntryMode>("open");
  const value = useMemo(
    () => ({
      showRepoEntry: (mode: RepoEntryMode = "open") => {
        setInitialMode(mode);
        setVisible(true);
      },
    }),
    [],
  );

  return (
    <RepoEntryContext.Provider value={value}>
      {children}
      {visible && (
        <RepoEntryDialog initialMode={initialMode} onClose={() => setVisible(false)} />
      )}
    </RepoEntryContext.Provider>
  );
}

export function useRepoEntry() {
  const context = useContext(RepoEntryContext);
  if (!context) throw new Error("useRepoEntry must be used within RepoEntryProvider");
  return context;
}

function RepoEntryDialog({
  initialMode,
  onClose,
}: {
  initialMode: RepoEntryMode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const openRepo = useRepoStore((state) => state.openRepo);
  const [mode, setMode] = useState<RepoEntryMode>(initialMode);
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloneTaskId, setCloneTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Esc during a busy operation must not close; the trap/guard lives here.
  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, () => {
    if (!busy) onClose();
  }, true);

  const chooseDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setPath(selected);
  };

  const pathError = path.trim() && !isAbsoluteDirectory(path)
    ? t("repoEntry.pathAbsolute")
    : null;
  const urlError = url.trim() && !isCloneUrlValid(url)
    ? t("repoEntry.urlInvalid")
    : null;
  const canSubmit = Boolean(path.trim()) && !pathError && (mode !== "clone" || (url.trim() && !urlError));

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = path.trim();
      let repoPath = target;
      if (mode === "open") {
        repoPath = await gitService.discoverRepo(target);
      } else if (mode === "clone") {
        // Run the clone as a cancellable task so a slow or hung clone can be
        // aborted from the dialog without closing it.
        const taskId = `clone-${Date.now()}`;
        setCloneTaskId(taskId);
        await gitService.cloneRepoTask(url.trim(), target, taskId);
      } else {
        await gitService.initRepo(target);
      }
      await openRepo(repoPath);
      onClose();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setCloneTaskId(null);
      setBusy(false);
    }
  };

  const cancelClone = () => {
    if (cloneTaskId) void gitService.cancelGitTask(cloneTaskId);
  };

  const tabs: Array<{ id: RepoEntryMode; icon: typeof FolderIcon }> = [
    { id: "open", icon: FolderIcon },
    { id: "clone", icon: DownloadIcon },
    { id: "init", icon: GitBranchIcon },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="repo-entry-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-lg rounded-lg border border-border bg-bg-surface shadow-xl">
        <div className="flex items-center px-5 h-14 border-b border-border">
          <h2 id="repo-entry-title" className="font-semibold">{t("repoEntry.title")}</h2>
          <div className="flex-1" />
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost" aria-label={t("common.cancel")}>
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex border-b border-border" role="tablist">
          {tabs.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => { setMode(id); setError(null); }}
              disabled={busy}
              className={clsx(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm border-b-2 transition-colors",
                mode === id ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <Icon size={15} /> {t(`repoEntry.${id}`)}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {mode === "clone" && (
            <label className="block text-sm">
              <span className="block mb-1.5 text-text-secondary">{t("repoEntry.cloneUrl")}</span>
              <input
                autoFocus
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
                placeholder={t("repoEntry.cloneUrlPlaceholder")}
                className="w-full bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
              />
              {urlError && <span className="block mt-1 text-xs text-danger">{urlError}</span>}
            </label>
          )}

          <label className="block text-sm">
            <span className="block mb-1.5 text-text-secondary">
              {t(mode === "open" ? "repoEntry.repositoryDirectory" : "repoEntry.targetDirectory")}
            </span>
            <div className="flex gap-2">
              <input
                autoFocus={mode !== "clone"}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
                disabled={busy}
                placeholder={t("repoEntry.directoryPlaceholder")}
                className="flex-1 min-w-0 bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
              />
              <button type="button" onClick={chooseDirectory} disabled={busy} className="btn-secondary">
                <FolderIcon size={14} /> {t("repoEntry.browse")}
              </button>
            </div>
            {pathError && <span className="block mt-1 text-xs text-danger">{pathError}</span>}
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
              <span className="break-words whitespace-pre-wrap">{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">{t("common.cancel")}</button>
          {mode === "clone" && busy && cloneTaskId && (
            <button type="button" onClick={cancelClone} className="btn-ghost">
              {t("repoEntry.cancelClone")}
            </button>
          )}
          <button type="button" onClick={() => void submit()} disabled={!canSubmit || busy} aria-busy={busy} className="btn-primary">
            {busy && <SpinnerIcon size={14} />}
            {busy ? t(`repoEntry.${mode}Working`) : t(`repoEntry.${mode}Action`)}
          </button>
        </div>
      </div>
    </div>
  );
}
