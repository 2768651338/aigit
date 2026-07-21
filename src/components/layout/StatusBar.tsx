import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { GitBranchIcon, GitCommitIcon, CircleDotIcon } from "@/components/common/Icons";

export function StatusBar() {
  const { t } = useTranslation();
  const { repoInfo, fileStatuses } = useRepoStore();

  if (!repoInfo) {
    return (
      <footer className="flex items-center px-4 h-8 bg-bg-surface border-t border-border text-xs text-text-muted">
        <span>{t("statusBar.noRepo")}</span>
      </footer>
    );
  }

  const staged = fileStatuses.filter((f) => f.staged).length;
  const unstaged = fileStatuses.filter((f) => !f.staged).length;

  return (
    <footer className="flex items-center gap-4 px-4 h-8 bg-bg-surface border-t border-border text-xs text-text-secondary">
      <div className="flex items-center gap-1.5">
        <GitBranchIcon size={13} className="text-text-secondary" />
        <span className="font-medium text-text-primary">
          {repoInfo.current_branch ?? "HEAD"}
        </span>
        {(repoInfo.ahead > 0 || repoInfo.behind > 0) && (
          <span className="flex items-center gap-1 ml-1">
            {repoInfo.ahead > 0 && (
              <span className="text-success">↑{repoInfo.ahead}</span>
            )}
            {repoInfo.behind > 0 && (
              <span className="text-danger">↓{repoInfo.behind}</span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <CircleDotIcon size={13} />
        <span>{t("statusBar.staged", { count: staged })}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <GitCommitIcon size={13} />
        <span>{t("statusBar.modified", { count: unstaged })}</span>
      </div>

      <div className="flex-1" />

      <div className="text-text-muted truncate max-w-xs">
        {repoInfo.head_hash ? repoInfo.head_hash.slice(0, 7) : ""}
      </div>
    </footer>
  );
}
