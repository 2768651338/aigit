import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import { useToastStore } from "@/stores/toastStore";
import { formatRelativeTime } from "@/utils/time";
import {
  AlertCircleIcon,
  HistoryIcon,
  RefreshIcon,
  SpinnerIcon,
  TrashIcon,
  UndoIcon,
} from "@/components/common/Icons";
import type { OperationRecord } from "@/types";
import clsx from "clsx";

const KNOWN_KINDS = new Set([
  "pull",
  "push",
  "merge",
  "rebase",
  "revert",
  "cherry_pick",
  "reset",
  "checkout",
  "discard",
  "history_rewrite",
  "undo",
]);

/** 撤销中心：本仓库最近的危险操作时间线 + 防呆一键撤销。 */
export function OperationHistoryView() {
  const { t } = useTranslation();
  const toast = useToastStore();
  const { currentPath, refreshStatus } = useRepoStore(
    useShallow((s) => ({
      currentPath: s.currentPath,
      refreshStatus: s.refreshStatus,
    })),
  );
  const [records, setRecords] = useState<OperationRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    if (!currentPath) {
      setRecords(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRecords(await gitService.listOperationHistory(currentPath));
    } catch (e) {
      setError(formatError(e));
      setRecords(null);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (record: OperationRecord) => {
    if (!currentPath) return;
    const confirmed = await confirmDialog(
      t("oplog.undoTitle"),
      t("oplog.undoConfirm", { summary: record.summary }),
      "warning",
    );
    if (!confirmed) return;
    setUndoingId(record.id);
    try {
      const outcome = await gitService.undoOperation(currentPath, record.id, true);
      if (outcome.backup_branch) {
        toast.info(
          t("oplog.undoStashedNote"),
          t("oplog.undoSuccessWithBackup", { branch: outcome.backup_branch }),
        );
      } else {
        toast.success(t("oplog.undoSuccess"), t("oplog.title"));
      }
      await load();
      // 撤销可能移动了分支：强制刷新当前仓库的所有状态。
      refreshStatus(true);
    } catch (e) {
      toast.error(formatError(e), t("oplog.undoFailed"));
    } finally {
      setUndoingId(null);
    }
  };

  const clear = async () => {
    if (!currentPath) return;
    const confirmed = await confirmDialog(
      t("oplog.clearTitle"),
      t("oplog.clearConfirm"),
      "warning",
    );
    if (!confirmed) return;
    setClearing(true);
    try {
      await gitService.clearOperationHistory(currentPath);
      await load();
    } catch (e) {
      toast.error(formatError(e), t("oplog.clearFailed"));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h1 className="text-sm font-semibold flex-1">{t("oplog.title")}</h1>
        {records !== null && records.length > 0 && (
          <button
            type="button"
            className="btn-ghost text-xs text-danger"
            onClick={() => void clear()}
            disabled={clearing}
          >
            <TrashIcon size={14} />
            {t("oplog.clear")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => void load()}
          disabled={loading || !currentPath}
        >
          {loading ? (
            <SpinnerIcon size={14} className="animate-spin" />
          ) : (
            <RefreshIcon size={14} />
          )}
          {t("dashboard.refresh")}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {!currentPath && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-muted">
            <HistoryIcon size={28} />
            <p className="text-sm">{t("oplog.needRepo")}</p>
          </div>
        )}

        {currentPath && error && (
          <div className="flex items-start gap-2 p-3.5 bg-danger/10 text-danger text-sm rounded border border-danger/20">
            <AlertCircleIcon size={16} />
            <span>{error}</span>
          </div>
        )}

        {currentPath && !error && records !== null && records.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-muted">
            <HistoryIcon size={28} />
            <p className="text-sm">{t("oplog.empty")}</p>
          </div>
        )}

        {currentPath && !error && records !== null && records.length > 0 && (
          <div className="flex flex-col gap-1.5 max-w-4xl">
            <p className="text-xs text-text-muted mb-1">{t("oplog.reflogHint")}</p>
            <ul className="flex flex-col">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded hover:bg-bg-hover text-sm"
                >
                  <span
                    className={clsx(
                      "badge shrink-0",
                      record.kind === "undo"
                        ? "bg-bg-hover text-text-muted"
                        : "bg-accent/10 text-accent",
                    )}
                  >
                    {KNOWN_KINDS.has(record.kind)
                      ? t(`oplog.kind.${record.kind}`)
                      : record.kind}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-text-secondary" title={record.summary}>
                      {record.summary}
                    </span>
                  </span>
                  <span className="text-xs text-text-muted shrink-0">
                    {formatRelativeTime(record.timestamp)}
                  </span>
                  {record.reversible ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs shrink-0"
                      onClick={() => void undo(record)}
                      disabled={undoingId !== null}
                    >
                      {undoingId === record.id ? (
                        <SpinnerIcon size={12} className="animate-spin" />
                      ) : (
                        <UndoIcon size={12} />
                      )}
                      {t("oplog.undo")}
                    </button>
                  ) : (
                    <span
                      className="text-xs text-text-muted shrink-0 px-2"
                      title={t("oplog.notReversibleHint")}
                    >
                      {t("oplog.notReversible")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
