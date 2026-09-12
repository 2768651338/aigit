import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import { useModalAccessibility } from "@/utils/modalA11y";
import { CheckIcon, HistoryIcon, SpinnerIcon, XIcon } from "@/components/common/Icons";

interface ReflogPanelProps {
  onClose: () => void;
}

interface ReflogEntry {
  old_hash: string;
  new_hash: string;
  short_hash: string;
  author: string;
  timestamp: number;
  message: string;
}

/** 恢复面板：列出 HEAD reflog 的最近移动，帮助找回被 reset/rebase
 *  甩开的提交。支持从任意记录检出（detached）或就地建分支。 */
export function ReflogPanel({ onClose }: ReflogPanelProps) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const toast = useToastStore();
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branchTarget, setBranchTarget] = useState<ReflogEntry | null>(null);
  const [branchName, setBranchName] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, onClose, true);

  useEffect(() => {
    if (!currentPath) return;
    let alive = true;
    gitService
      .listHeadReflog(currentPath)
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch((e) => {
        console.error(e);
        if (alive) setError(formatError(e));
      });
    return () => {
      alive = false;
    };
  }, [currentPath]);

  const checkout = async (entry: ReflogEntry) => {
    if (!currentPath) return;
    const confirmed = await confirmDialog(
      t("common.confirmAction"),
      t("reflog.checkoutConfirm", { hash: entry.short_hash }),
      "warning",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await gitService.checkoutCommit(currentPath, entry.new_hash);
      await useRepoStore.getState().refreshStatus(true);
      toast.success(t("reflog.checkedOut", { hash: entry.short_hash }));
      onClose();
    } catch (e) {
      toast.error(formatError(e), t("reflog.checkoutFailed"));
    } finally {
      setBusy(false);
    }
  };

  const createBranchAt = async () => {
    if (!currentPath || !branchTarget) return;
    const name = branchName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await gitService.createBranch(currentPath, name, branchTarget.new_hash);
      await Promise.all([
        useRepoStore.getState().refreshBranches(true),
        useRepoStore.getState().refreshLog(true),
      ]);
      toast.success(t("reflog.branchCreated", { name, hash: branchTarget.short_hash }));
      setBranchTarget(null);
      setBranchName("");
    } catch (e) {
      toast.error(formatError(e), t("reflog.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60" role="dialog" aria-modal="true" aria-label={t("reflog.title")}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="m-5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-base shadow-2xl"
      >
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <HistoryIcon size={16} />
          <h2 className="font-semibold">{t("reflog.title")}</h2>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={16} />
          </button>
        </div>
        <p className="border-b border-border px-4 py-2.5 text-xs text-text-muted">
          {t("reflog.hint")}
        </p>
        <div className="flex-1 overflow-auto p-4">
          {error && <div className="text-sm text-danger break-all">{error}</div>}
          {!error && entries === null && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <SpinnerIcon size={14} />
              {t("common.loading")}
            </div>
          )}
          {entries && entries.length === 0 && (
            <p className="text-sm text-text-muted">{t("reflog.empty")}</p>
          )}
          {entries && entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map((entry, idx) => (
                <div
                  key={`${entry.new_hash}-${idx}`}
                  className="flex items-center gap-3 rounded border border-border px-3 py-2"
                >
                  <span className="font-mono text-xs text-accent shrink-0">{entry.short_hash}</span>
                  <span className="text-sm text-text-primary truncate flex-1" title={entry.message}>
                    {entry.message || t("reflog.noMessage")}
                  </span>
                  <span className="text-xs text-text-muted shrink-0 hidden sm:block">{entry.author}</span>
                  <span className="text-xs text-text-muted shrink-0">
                    {new Date(entry.timestamp * 1000).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost text-xs shrink-0"
                    disabled={busy}
                    onClick={() => setBranchTarget(entry)}
                  >
                    {t("reflog.createBranch")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs shrink-0"
                    disabled={busy}
                    onClick={() => void checkout(entry)}
                  >
                    {t("reflog.checkout")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {branchTarget && (
          <div className="border-t border-border p-3 flex items-center gap-2">
            <span className="text-xs text-text-muted shrink-0">
              {t("reflog.branchAt", { hash: branchTarget.short_hash })}
            </span>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void createBranchAt()}
              placeholder={t("branches.branchNamePlaceholder")}
              className="input text-xs py-1.5 flex-1"
              autoFocus
            />
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={busy || !branchName.trim()}
              onClick={() => void createBranchAt()}
            >
              <CheckIcon size={13} />
              {t("reflog.createConfirm")}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setBranchTarget(null);
                setBranchName("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
