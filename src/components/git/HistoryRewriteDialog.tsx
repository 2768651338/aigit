import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { useModalAccessibility } from "@/utils/modalA11y";
import type { LogEntry } from "@/types";
import { SpinnerIcon, XIcon } from "@/components/common/Icons";
import clsx from "clsx";

interface HistoryRewriteDialogProps {
  /** 所选提交：整理范围 = 从该提交到 HEAD。 */
  startEntry: LogEntry;
  /** 已加载的提交（最新在前）。 */
  loadedLog: LogEntry[];
  onClose: () => void;
}

interface Row {
  hash: string;
  original: string;
  message: string;
  squash: boolean;
  dropped: boolean;
}

/** 历史整理对话框：对从所选提交到 HEAD 的提交做改写（reword）、
 *  合并（squash）与丢弃（drop）。不支持调换顺序（快照树语义限制）。 */
export function HistoryRewriteDialog({
  startEntry,
  loadedLog,
  onClose,
}: HistoryRewriteDialogProps) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const refreshLog = useRepoStore((s) => s.refreshLog);
  const refreshBranches = useRepoStore((s) => s.refreshBranches);
  const toast = useToastStore();
  const [applying, setApplying] = useState(false);

  // loadedLog 最新在前；切为最老在前并截取从所选提交到 HEAD 的区段。
  const rows = useMemo<Row[]>(() => {
    const idx = loadedLog.findIndex((e) => e.hash === startEntry.hash);
    const tail = (idx >= 0 ? loadedLog.slice(0, idx + 1) : [startEntry])
      .slice()
      .reverse();
    return tail.map((entry) => ({
      hash: entry.hash,
      original: entry.message,
      message: entry.message,
      squash: false,
      dropped: false,
    }));
  }, [loadedLog, startEntry]);

  const [messages, setMessages] = useState<Record<string, string>>({});
  const [squashed, setSquashed] = useState<Record<string, boolean>>({});
  const [dropped, setDropped] = useState<Record<string, boolean>>({});

  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, onClose, true);

  const getValue = (row: Row) => messages[row.hash] ?? row.original;

  const buildSteps = () =>
    rows
      .filter((row) => !dropped[row.hash])
      .map((row) => ({
        hash: row.hash,
        message: getValue(row).trim() || row.original,
        squash: squashed[row.hash] ?? false,
      }));

  const apply = async () => {
    if (!currentPath) return;
    const steps = buildSteps();
    if (steps.length === 0) {
      toast.error(t("rewrite.emptySteps"));
      return;
    }
    setApplying(true);
    try {
      await gitService.rewriteHistory(currentPath, steps);
      await Promise.all([refreshLog(true), refreshBranches(true)]);
      toast.success(t("rewrite.applied"));
      onClose();
    } catch (e) {
      toast.error(formatError(e), t("rewrite.applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  const firstKept = rows.find((row) => !dropped[row.hash]);
  const firstIsSquash = firstKept ? (squashed[firstKept.hash] ?? false) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t("rewrite.title")}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="m-5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-base shadow-2xl"
      >
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <h2 className="font-semibold">{t("rewrite.title")}</h2>
          <span className="text-xs text-text-muted">{t("rewrite.rangeHint")}</span>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={16} />
          </button>
        </div>

        <p className="border-b border-border px-4 py-2.5 text-xs text-text-muted">
          {t("rewrite.warning")}
        </p>

        <div className="flex-1 overflow-auto p-4 space-y-1.5">
          {rows.map((row, idx) => {
            const isDropped = dropped[row.hash] ?? false;
            const isSquash = squashed[row.hash] ?? false;
            const isFirstKept = firstKept?.hash === row.hash;
            return (
              <div
                key={row.hash}
                className={clsx(
                  "flex items-center gap-2 rounded border px-2.5 py-2",
                  isDropped
                    ? "border-border bg-bg-surface opacity-50"
                    : "border-border",
                )}
              >
                <span className="font-mono text-xs text-accent shrink-0">
                  {row.hash.slice(0, 7)}
                </span>
                <input
                  type="text"
                  value={getValue(row)}
                  disabled={applying || isSquash || isDropped}
                  onChange={(e) =>
                    setMessages((prev) => ({ ...prev, [row.hash]: e.target.value }))
                  }
                  className="input text-xs py-1.5 flex-1 min-w-0"
                  aria-label={t("rewrite.messageFor", { hash: row.hash.slice(0, 7) })}
                />
                <label className="flex items-center gap-1 text-2xs text-text-secondary shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSquash}
                    disabled={applying || isDropped || isFirstKept}
                    onChange={(e) =>
                      setSquashed((prev) => ({ ...prev, [row.hash]: e.target.checked }))
                    }
                    className="accent-accent w-3.5 h-3.5"
                  />
                  {t("rewrite.squash")}
                </label>
                <label className="flex items-center gap-1 text-2xs text-text-secondary shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDropped}
                    disabled={applying}
                    onChange={(e) =>
                      setDropped((prev) => ({ ...prev, [row.hash]: e.target.checked }))
                    }
                    className="accent-accent w-3.5 h-3.5"
                  />
                  {t("rewrite.drop")}
                </label>
                <span className="text-2xs text-text-muted shrink-0 hidden sm:block">
                  #{idx + 1}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-text-muted flex-1">{t("rewrite.note")}</span>
          <button className="btn-ghost text-xs" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            className="btn-primary text-xs"
            disabled={applying || firstIsSquash}
            onClick={() => void apply()}
          >
            {applying && <SpinnerIcon size={13} />}
            {t("rewrite.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
