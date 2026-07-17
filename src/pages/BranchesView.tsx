import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { BranchGraph } from "@/components/git/BranchGraph";
import {
  GitBranchIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  CheckIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

export function BranchesView() {
  const { t } = useTranslation();
  const {
    currentPath,
    branches,
    refreshBranches,
    createBranch,
    switchBranch,
    deleteBranch,
  } = useRepoStore();

  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("branches.openRepoHint")}
      </div>
    );
  }

  const localBranches = branches.filter((b) => !b.is_remote);
  const remoteBranches = branches.filter((b) => b.is_remote);

  const handleCreate = async () => {
    if (!newBranchName.trim()) return;
    try {
      await createBranch(newBranchName.trim());
      await refreshBranches();
      await switchBranch(newBranchName.trim());
      setNewBranchName("");
      setShowNewBranch(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full">
      {/* Branch list sidebar */}
      <div className="w-64 border-r border-border flex flex-col overflow-hidden">
        <div className="flex items-center px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold flex-1">{t("branches.title")}</span>
          <button
            onClick={() => setShowNewBranch(!showNewBranch)}
            className="btn-ghost"
            title={t("branches.newBranch")}
          >
            <PlusIcon size={14} />
          </button>
          <button onClick={refreshBranches} className="btn-ghost" title={t("changes.refresh")}>
            <RefreshIcon size={14} />
          </button>
        </div>

        {showNewBranch && (
          <div className="flex items-center gap-1 px-2 py-2 border-b border-border">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={t("branches.branchNamePlaceholder")}
              className="input text-xs py-1"
              autoFocus
            />
            <button onClick={handleCreate} className="btn-primary p-1">
              <CheckIcon size={12} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <div className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
            {t("branches.local")}
          </div>
          <div className="px-2 space-y-0.5">
            {localBranches.map((branch) => (
              <div
                key={branch.name}
                className={clsx(
                  "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group",
                  branch.is_current ? "bg-accent-glow" : "hover:bg-bg-hover"
                )}
                onClick={() => !branch.is_current && switchBranch(branch.name)}
              >
                <GitBranchIcon
                  size={14}
                  className={branch.is_current ? "text-accent" : "text-text-muted"}
                />
                <span
                  className={clsx(
                    "flex-1 text-xs truncate",
                    branch.is_current ? "text-accent font-medium" : "text-text-primary"
                  )}
                >
                  {branch.name}
                </span>
                {!branch.is_current && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBranch(branch.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity"
                  >
                    <TrashIcon size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {remoteBranches.length > 0 && (
            <>
              <div className="px-3 py-2 mt-2 text-2xs font-semibold uppercase tracking-wider text-text-muted border-t border-border-subtle">
                {t("branches.remote")}
              </div>
              <div className="px-2 space-y-0.5">
                {remoteBranches.map((branch) => (
                  <div
                    key={branch.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover cursor-pointer"
                  >
                    <GitBranchIcon size={14} className="text-text-muted" />
                    <span className="flex-1 text-xs truncate text-text-secondary">
                      {branch.name}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Commit graph */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center px-4 h-10 border-b border-border">
          <h2 className="text-sm font-semibold">{t("branches.history")}</h2>
        </div>
        <div className="flex-1 overflow-hidden">
          <BranchGraph />
        </div>
      </div>
    </div>
  );
}
