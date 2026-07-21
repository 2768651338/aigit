import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
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
  const toast = useToastStore();

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
      toast.success(t("branches.branchCreated", { name: newBranchName.trim() }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.branchCreateFailed"));
    }
  };

  const handleSwitch = async (name: string) => {
    try {
      await switchBranch(name);
      toast.success(t("branches.switched", { name }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.switchFailed"));
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteBranch(name);
      toast.success(t("branches.branchDeleted", { name }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.branchDeleteFailed"));
    }
  };

  return (
    <div className="flex h-full">
      {/* Branch list sidebar */}
      <div className="w-72 border-r border-border flex flex-col overflow-hidden">
        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-base font-semibold flex-1">{t("branches.title")}</span>
          <button
            onClick={() => setShowNewBranch(!showNewBranch)}
            className="btn-ghost"
            title={t("branches.newBranch")}
          >
            <PlusIcon size={16} />
          </button>
          <button onClick={refreshBranches} className="btn-ghost" title={t("changes.refresh")}>
            <RefreshIcon size={16} />
          </button>
        </div>

        {showNewBranch && (
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={t("branches.branchNamePlaceholder")}
              className="input text-sm py-1.5"
              autoFocus
            />
            <button onClick={handleCreate} className="btn-primary px-2.5 py-1.5">
              <CheckIcon size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("branches.local")}
          </div>
          <div className="px-3 space-y-1">
            {localBranches.map((branch) => (
              <div
                key={branch.name}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2 rounded cursor-pointer group",
                  branch.is_current ? "bg-bg-hover" : "hover:bg-bg-hover"
                )}
                onClick={() => !branch.is_current && handleSwitch(branch.name)}
              >
                <GitBranchIcon
                  size={16}
                  className={branch.is_current ? "text-text-primary" : "text-text-muted"}
                />
                <span
                  className={clsx(
                    "flex-1 text-sm truncate",
                    branch.is_current ? "text-text-primary font-medium" : "text-text-primary"
                  )}
                >
                  {branch.name}
                </span>
                {!branch.is_current && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(branch.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity"
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {remoteBranches.length > 0 && (
            <>
              <div className="px-4 py-2.5 mt-2 text-xs font-semibold uppercase tracking-wider text-text-muted border-t border-border-subtle">
                {t("branches.remote")}
              </div>
              <div className="px-3 space-y-1">
                {remoteBranches.map((branch) => (
                  <div
                    key={branch.name}
                    className="flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-hover cursor-pointer"
                  >
                    <GitBranchIcon size={16} className="text-text-muted" />
                    <span className="flex-1 text-sm truncate text-text-secondary">
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
        <div className="flex items-center px-5 h-12 border-b border-border">
          <h2 className="text-base font-semibold">{t("branches.history")}</h2>
        </div>
        <div className="flex-1 overflow-hidden">
          <BranchGraph />
        </div>
      </div>
    </div>
  );
}
