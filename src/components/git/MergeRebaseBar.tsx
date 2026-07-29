import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import {
  GitMergeIcon,
  GitPullRequestIcon,
  AlertCircleIcon,
  SpinnerIcon,
  PlayIcon,
  SkipForwardIcon,
  XIcon,
} from "@/components/common/Icons";

/**
 * Merge / Rebase control bar.
 *
 * Two responsibilities:
 *   1. When no merge/rebase is in progress: show a branch picker + "merge" /
 *      "rebase" buttons to start an operation against the current branch.
 *   2. When a merge/rebase is in progress (with or without conflicts): show
 *      conflict status, conflicted-file list with "use ours / use theirs"
 *      quick resolve, and Continue / Skip / Abort controls.
 *
 * Rendered at the top of the BranchesView's right panel.
 */
export function MergeRebaseBar() {
  const { t } = useTranslation();
  const {
    currentPath,
    branches,
    repoInfo,
    mergeInProgress,
    isRebasing,
    conflicts,
    merging,
    mergeBranch,
    rebaseBranch,
    abortMerge,
    abortRebase,
    continueMerge,
    continueRebase,
    skipRebase,
    resolveOurs,
    resolveTheirs,
    refreshMergeState,
  } = useRepoStore();
  const toast = useToastStore();

  const [targetBranch, setTargetBranch] = useState("");
  const [noFf, setNoFf] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  // Refresh merge state on mount.
  useEffect(() => {
    if (currentPath) {
      void refreshMergeState();
    }
  }, [currentPath, refreshMergeState]);

  // Auto-select first non-current local branch.
  useEffect(() => {
    if (!targetBranch && branches.length > 0) {
      const first = branches.find((b) => !b.is_remote && !b.is_current);
      if (first) setTargetBranch(first.name);
    }
  }, [branches, targetBranch]);

  const currentBranch = repoInfo?.current_branch ?? "";
  const localBranches = branches.filter((b) => !b.is_remote && !b.is_current);

  const handleMerge = async () => {
    if (!targetBranch) return;
    try {
      const result = await mergeBranch(targetBranch, noFf);
      if (result.has_conflicts) {
        toast.error(t("branches.mergeConflicts"), t("branches.mergeIntoCurrent"));
      } else {
        toast.success(t("branches.mergeSuccess"));
      }
    } catch (e) {
      toast.error(formatError(e), t("branches.mergeIntoCurrent"));
    }
  };

  const handleRebase = async () => {
    if (!targetBranch) return;
    try {
      const result = await rebaseBranch(targetBranch);
      if (result.has_conflicts) {
        toast.error(t("branches.rebaseConflict"), t("branches.rebaseOntoCurrent"));
      } else {
        toast.success(t("branches.mergeSuccess"));
      }
    } catch (e) {
      toast.error(formatError(e), t("branches.rebaseOntoCurrent"));
    }
  };

  const handleAbort = async () => {
    const confirmKey = isRebasing
      ? "branches.rebaseAbortConfirm"
      : "branches.mergeAbortConfirm";
    const confirmed = await confirmDialog(
      isRebasing ? t("branches.abortRebase") : t("branches.abortMerge"),
      t(confirmKey),
      "warning"
    );
    if (!confirmed) return;
    try {
      if (isRebasing) {
        await abortRebase();
      } else {
        await abortMerge();
      }
      toast.success(t("common.ok"));
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const handleContinue = async () => {
    try {
      if (isRebasing) {
        await continueRebase();
      } else {
        await continueMerge();
      }
      toast.success(t("common.ok"));
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const handleSkip = async () => {
    try {
      await skipRebase();
      toast.success(t("common.ok"));
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const handleResolve = async (file: string, ours: boolean) => {
    setResolving(file);
    try {
      if (ours) {
        await resolveOurs([file]);
      } else {
        await resolveTheirs([file]);
      }
      toast.success(t("branches.resolved"));
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setResolving(null);
    }
  };

  // ----- In-progress view (merge or rebase) -----
  if (mergeInProgress) {
    return (
      <div className="border-b border-warning/30 bg-warning/5">
        <div className="flex items-center gap-3 px-4 py-2.5">
          {isRebasing ? (
            <GitPullRequestIcon size={16} className="text-warning shrink-0" />
          ) : (
            <GitMergeIcon size={16} className="text-warning shrink-0" />
          )}
          <span className="text-sm font-medium text-warning">
            {isRebasing ? t("branches.rebaseInProgress") : t("branches.mergeInProgress")}
          </span>
          {conflicts.length > 0 && (
            <span className="text-xs text-danger flex items-center gap-1">
              <AlertCircleIcon size={12} />
              {conflicts.length} {t("branches.conflictsTitle")}
            </span>
          )}
          <div className="flex-1" />
          {isRebasing && (
            <button
              onClick={handleSkip}
              disabled={merging}
              className="btn-ghost text-xs"
              title={t("branches.skipCommit")}
            >
              <SkipForwardIcon size={14} />
              {t("branches.skipCommit")}
            </button>
          )}
          <button
            onClick={handleContinue}
            disabled={merging}
            className="btn-secondary text-xs"
            title={isRebasing ? t("branches.continueRebase") : t("branches.continueMerge")}
          >
            {merging ? <SpinnerIcon size={14} /> : <PlayIcon size={14} />}
            {isRebasing ? t("branches.continueRebase") : t("branches.continueMerge")}
          </button>
          <button
            onClick={handleAbort}
            disabled={merging}
            className="btn-ghost text-xs text-danger"
            title={isRebasing ? t("branches.abortRebase") : t("branches.abortMerge")}
          >
            <XIcon size={14} />
            {isRebasing ? t("branches.abortRebase") : t("branches.abortMerge")}
          </button>
        </div>

        {conflicts.length > 0 && (
          <div className="px-4 pb-3">
            <div className="text-xs text-text-muted mb-1.5">
              {t("branches.conflictsTitle")}
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">
              {conflicts.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-elevated border border-border rounded text-xs"
                >
                  <AlertCircleIcon size={12} className="text-danger shrink-0" />
                  <span className="font-mono text-text-primary truncate flex-1">
                    {file}
                  </span>
                  {resolving === file ? (
                    <SpinnerIcon size={12} className="text-text-muted" />
                  ) : (
                    <>
                      <button
                        onClick={() => handleResolve(file, true)}
                        className="btn-ghost text-2xs px-1.5 py-0.5"
                        title={t("branches.resolveOurs")}
                      >
                        {t("branches.resolveOurs")}
                      </button>
                      <button
                        onClick={() => handleResolve(file, false)}
                        className="btn-ghost text-2xs px-1.5 py-0.5"
                        title={t("branches.resolveTheirs")}
                      >
                        {t("branches.resolveTheirs")}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----- Idle view: branch picker + start merge/rebase -----
  if (localBranches.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-surface">
      <GitMergeIcon size={14} className="text-text-muted shrink-0" />
      <select
        value={targetBranch}
        onChange={(e) => setTargetBranch(e.target.value)}
        className="input text-xs py-1 px-2 max-w-48"
        disabled={merging}
      >
        {localBranches.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
      <span className="text-2xs text-text-muted">→ {currentBranch || "HEAD"}</span>
      <label className="flex items-center gap-1 text-2xs text-text-secondary cursor-pointer ml-1">
        <input
          type="checkbox"
          checked={noFf}
          onChange={(e) => setNoFf(e.target.checked)}
          className="accent-accent"
          disabled={merging}
        />
        {t("branches.mergeNoFf")}
      </label>
      <div className="flex-1" />
      <button
        onClick={handleMerge}
        disabled={!targetBranch || merging}
        className="btn-secondary text-xs"
        title={t("branches.mergeIntoCurrent")}
      >
        {merging ? <SpinnerIcon size={14} /> : <GitMergeIcon size={14} />}
        {t("branches.mergeIntoCurrent")}
      </button>
      <button
        onClick={handleRebase}
        disabled={!targetBranch || merging}
        className="btn-ghost text-xs"
        title={t("branches.rebaseOntoCurrent")}
      >
        {merging ? <SpinnerIcon size={14} /> : <GitPullRequestIcon size={14} />}
        {t("branches.rebaseOntoCurrent")}
      </button>
    </div>
  );
}
