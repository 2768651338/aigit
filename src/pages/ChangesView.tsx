import { useRepoStore } from "@/stores/repoStore";
import { useTranslation } from "react-i18next";
import { FileStatusList } from "@/components/git/FileStatusList";
import { DiffViewer } from "@/components/git/DiffViewer";
import { CommitPanel } from "@/components/git/CommitPanel";
import { RefreshIcon, AlertCircleIcon, SpinnerIcon, FolderIcon } from "@/components/common/Icons";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { useToastStore } from "@/stores/toastStore";

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
        <div className="w-96 border-r border-border flex flex-col overflow-hidden">
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

          {/* Commit panel */}
          <div className="border-t border-border h-72 shrink-0">
            <CommitPanel />
          </div>
        </div>

        {/* Right: Diff viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center px-5 h-12 border-b border-border">
            <span className="text-sm font-medium text-text-primary">
              {selectedFile ?? t("changes.selectFile")}
            </span>
          </div>
          <div className="flex-1 overflow-auto">
            <DiffViewer diffs={showDiff} className="h-full" />
          </div>
        </div>
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
