import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { pathLeaf } from "@/utils/path";
import {
  GitBranchIcon,
  GitCommitIcon,
  CircleDotIcon,
  GitMergeIcon,
  SpinnerIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

export function StatusBar() {
  const { t } = useTranslation();
  const { repoInfo, fileStatuses, committing, commitAndPushing, pushing, pulling, aiLoading } =
    useRepoStore(
      useShallow((s) => ({
        repoInfo: s.repoInfo,
        fileStatuses: s.fileStatuses,
        committing: s.committing,
        commitAndPushing: s.commitAndPushing,
        pushing: s.pushing,
        pulling: s.pulling,
        aiLoading: s.aiLoading,
      })),
    );
  // 多仓库聚合：一览所有已打开仓库的未提交 / 领先落后 / 合并状态。
  const tabs = useRepoStore(useShallow((s) => s.tabs));
  const tabOrder = useRepoStore((s) => s.tabOrder);
  const activePath = useRepoStore((s) => s.activePath);
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);
  const [showOverview, setShowOverview] = useState(false);

  // Compute the most informative in-progress label. Precedence:
  // commit & push > commit > push > pull > AI. Only one is shown at a time.
  let busyLabel: string | null = null;
  if (commitAndPushing) busyLabel = t("statusBar.committingAndPushing");
  else if (committing) busyLabel = t("statusBar.committing");
  else if (pushing) busyLabel = t("statusBar.pushing");
  else if (pulling) busyLabel = t("statusBar.pulling");
  else if (aiLoading) busyLabel = t("statusBar.aiWorking");

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
      {busyLabel ? (
        <div className="flex items-center gap-1.5 text-accent">
          <SpinnerIcon size={12} />
          <span className="font-medium">{busyLabel}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <GitBranchIcon size={13} className="text-text-secondary" />
          <span className="font-medium text-text-primary">
            {repoInfo.current_branch ?? t("statusBar.detachedHead")}
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
      )}

      <div className="flex items-center gap-1.5">
        <CircleDotIcon size={13} />
        <span>{t("statusBar.staged", { count: staged })}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <GitCommitIcon size={13} />
        <span>{t("statusBar.modified", { count: unstaged })}</span>
      </div>

      {tabOrder.length > 1 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowOverview((v) => !v)}
            aria-expanded={showOverview}
            className={clsx(
              "flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors hover:bg-bg-hover",
              showOverview && "bg-bg-hover text-text-primary",
            )}
          >
            {t("statusBar.repoOverview", { count: tabOrder.length })}
          </button>
          {showOverview && (
            <div className="absolute bottom-full left-0 mb-1 w-80 max-w-[80vw] bg-bg-elevated border border-border rounded shadow-lg z-40 overflow-hidden">
              {tabOrder.map((path) => {
                const tab = tabs[path];
                const info = tab?.repoInfo;
                const st = tab?.fileStatuses ?? [];
                const stg = st.filter((f) => f.staged).length;
                const unst = st.length - stg;
                const merging = tab?.mergeInProgress ?? false;
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() => {
                      setActiveRepo(path);
                      setShowOverview(false);
                    }}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover",
                      path === activePath && "bg-bg-hover",
                    )}
                    title={path}
                  >
                    {merging ? (
                      <GitMergeIcon size={13} className="shrink-0 text-warning" />
                    ) : (
                      <GitBranchIcon size={13} className="shrink-0 text-text-muted" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-text-primary truncate">
                        {info?.name ?? pathLeaf(path)}
                      </span>
                      <span className="block text-2xs text-text-muted truncate">
                        {info?.current_branch ?? t("statusBar.detachedHead")}
                      </span>
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5 text-2xs">
                      {info && info.ahead > 0 && (
                        <span className="text-success">↑{info.ahead}</span>
                      )}
                      {info && info.behind > 0 && (
                        <span className="text-danger">↓{info.behind}</span>
                      )}
                      {unst > 0 && <span className="text-text-secondary">~{unst}</span>}
                      {stg > 0 && <span className="text-accent">●{stg}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      <div className="text-text-muted truncate max-w-xs">
        {repoInfo.head_hash ? repoInfo.head_hash.slice(0, 7) : ""}
      </div>
    </footer>
  );
}
