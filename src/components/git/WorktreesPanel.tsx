import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { WorktreeInfo } from "@/types";
import {
  FolderIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

/** git worktree 管理面板：并列检出多分支；worktree 可一键作为仓库标签打开。 */
export function WorktreesPanel({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const openRepo = useRepoStore((s) => s.openRepo);
  const branches = useRepoStore((s) => s.branches);
  const toast = useToastStore();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [branch, setBranch] = useState("");

  const load = useCallback(async () => {
    if (!currentPath) return;
    setError(null);
    try {
      setWorktrees(await gitService.listWorktrees(currentPath));
    } catch (e) {
      console.error(e);
      setError(formatError(e));
    }
  }, [currentPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!currentPath || !name.trim() || !dirPath.trim()) return;
    setBusy(true);
    try {
      await gitService.addWorktree(
        currentPath,
        name.trim(),
        dirPath.trim(),
        branch || undefined,
      );
      toast.success(t("worktrees.added", { name: name.trim() }));
      setShowAdd(false);
      setName("");
      setDirPath("");
      setBranch("");
      await load();
    } catch (e) {
      toast.error(formatError(e), t("worktrees.addFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (worktree: WorktreeInfo) => {
    if (!currentPath) return;
    const confirmed = await confirmDialog(
      t("worktrees.removeTitle"),
      t("worktrees.removeConfirm", { name: worktree.name, path: worktree.path }),
      "warning",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await gitService.removeWorktree(currentPath, worktree.name, true);
      toast.success(t("worktrees.removed", { name: worktree.name }));
      await load();
    } catch (e) {
      toast.error(formatError(e), t("worktrees.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openAsRepo = async (worktree: WorktreeInfo) => {
    if (!worktree.path) return;
    try {
      await openRepo(worktree.path);
      toast.success(t("worktrees.openedAsRepo"));
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const localBranches = branches.filter((b) => !b.is_remote);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <h2 className="text-base font-semibold shrink-0">{t("worktrees.title")}</h2>
        <div className="flex-1" />
        {onBack && (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("pullRequests.back")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowAdd((v) => !v)}
          title={t("worktrees.add")}
          aria-label={t("worktrees.add")}
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void load()}
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      {showAdd && (
        <div className="border-b border-border p-4 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("worktrees.namePlaceholder")}
              className="input text-xs py-1.5 flex-1"
            />
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="input text-xs py-1.5 max-w-44"
              title={t("worktrees.branchOptional")}
            >
              <option value="">{t("worktrees.branchOptional")}</option>
              {localBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={dirPath}
            onChange={(e) => setDirPath(e.target.value)}
            placeholder={t("worktrees.pathPlaceholder")}
            className="input text-xs py-1.5 w-full"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setShowAdd(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={busy || !name.trim() || !dirPath.trim()}
              onClick={() => void add()}
            >
              {t("worktrees.create")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {error && <div className="text-sm text-danger break-all">{error}</div>}
        {!error && worktrees && worktrees.length === 0 && (
          <div className="py-10 text-center text-sm text-text-muted">
            {t("worktrees.empty")}
          </div>
        )}
        <div className="space-y-1.5">
          {(worktrees ?? []).map((worktree) => (
            <div
              key={worktree.name}
              className="flex items-center gap-3 rounded border border-border px-3 py-2.5"
            >
              <FolderIcon size={14} className="shrink-0 text-text-muted" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary truncate">{worktree.name}</span>
                  {worktree.is_current && (
                    <span className="badge text-2xs bg-accent/15 text-accent">
                      {t("worktrees.current")}
                    </span>
                  )}
                  {worktree.is_locked && (
                    <span className="badge text-2xs bg-bg-hover text-text-muted">
                      {t("worktrees.locked")}
                    </span>
                  )}
                </div>
                <div className="text-2xs text-text-muted truncate" title={worktree.path}>
                  {worktree.path || t("worktrees.prunable")}
                </div>
              </div>
              {worktree.path && !worktree.is_current && (
                <>
                  <button
                    type="button"
                    className="btn-ghost text-xs shrink-0"
                    disabled={busy}
                    onClick={() => void openAsRepo(worktree)}
                  >
                    {t("worktrees.openAsRepo")}
                  </button>
                  <button
                    type="button"
                    className={clsx("btn-ghost text-xs shrink-0 hover:text-danger")}
                    disabled={busy}
                    aria-label={t("worktrees.remove", { name: worktree.name })}
                    title={t("worktrees.remove", { name: worktree.name })}
                    onClick={() => void remove(worktree)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
