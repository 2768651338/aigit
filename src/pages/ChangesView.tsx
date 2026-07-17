import { useRepoStore } from "@/stores/repoStore";
import { useTranslation } from "react-i18next";
import { FileStatusList } from "@/components/git/FileStatusList";
import { DiffViewer } from "@/components/git/DiffViewer";
import { CommitPanel } from "@/components/git/CommitPanel";
import { RefreshIcon, AlertCircleIcon } from "@/components/common/Icons";
import { useEffect } from "react";

export function ChangesView() {
  const { t } = useTranslation();
  const {
    currentPath,
    selectedFile,
    workdirDiff,
    stagedDiff,
    refreshStatus,
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
        <div className="flex items-center gap-2 px-4 py-2 bg-danger/10 text-danger text-xs border-b border-danger/20">
          <AlertCircleIcon size={14} />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center px-4 h-10 border-b border-border">
        <h2 className="text-sm font-semibold">{t("changes.title")}</h2>
        <div className="flex-1" />
        <button onClick={refreshStatus} className="btn-ghost">
          <RefreshIcon size={14} />
          {t("changes.refresh")}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: File lists + commit */}
        <div className="w-80 border-r border-border flex flex-col overflow-hidden">
          {/* Staged section */}
          <div className="flex-1 overflow-auto">
            <div className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {t("changes.stagedChanges")}
            </div>
            <div className="px-2 pb-2">
              <FileStatusList staged={true} />
            </div>

            <div className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-text-muted border-t border-border-subtle">
              {t("changes.changes")}
            </div>
            <div className="px-2 pb-2">
              <FileStatusList staged={false} />
            </div>
          </div>

          {/* Commit panel */}
          <div className="border-t border-border h-64 shrink-0">
            <CommitPanel />
          </div>
        </div>

        {/* Right: Diff viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center px-4 h-10 border-b border-border">
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
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-bg-surface border border-border flex items-center justify-center mb-4">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-1">{t("changes.noRepoTitle")}</h2>
      <p className="text-sm text-text-secondary max-w-sm">
        {t("changes.noRepoDesc")}
      </p>
    </div>
  );
}
