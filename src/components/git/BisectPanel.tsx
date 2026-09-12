import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { BisectState } from "@/types";
import { RefreshIcon, SpinnerIcon } from "@/components/common/Icons";

/** bisect 向导：二分定位引入 bug 的提交。 */
export function BisectPanel({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const refreshStatus = useRepoStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [state, setState] = useState<BisectState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [bad, setBad] = useState("");
  const [good, setGood] = useState("");

  const load = useCallback(async () => {
    if (!currentPath) return;
    try {
      const next = await gitService.getBisectState(currentPath);
      setState(next);
      if (!next.in_progress && !bad && repoInfo?.head_hash) {
        setBad(repoInfo.head_hash);
      }
      setError(null);
    } catch (e) {
      console.error(e);
      setError(formatError(e));
    }
    // bad 只在首次填充时使用，避免覆盖用户输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, repoInfo?.head_hash]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<BisectState | void>) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) setState(next);
      await refreshStatus(true);
      setError(null);
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    void run(async () => {
      if (!currentPath) return;
      return gitService.bisectStart(currentPath, bad.trim() || undefined, good.trim() || undefined);
    });

  const mark = (verdict: "good" | "bad" | "skip") =>
    void run(async () => {
      if (!currentPath) return;
      return gitService.bisectMark(currentPath, verdict, undefined);
    });

  const reset = async () => {
    if (!currentPath) return;
    const confirmed = await confirmDialog(
      t("bisect.resetTitle"),
      t("bisect.resetConfirm"),
    );
    if (!confirmed) return;
    await run(async () => {
      await gitService.bisectReset(currentPath);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <h2 className="text-base font-semibold shrink-0">{t("bisect.title")}</h2>
        <span className="text-xs text-text-muted">{t("bisect.hint")}</span>
        <div className="flex-1" />
        {onBack && (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("pullRequests.back")}
          </button>
        )}
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

      <div className="flex-1 overflow-auto p-5">
        {error && <div className="text-sm text-danger break-all mb-3">{error}</div>}
        {state === null && <SpinnerIcon size={16} className="text-text-muted" />}

        {state && !state.in_progress && (
          <div className="max-w-xl space-y-3">
            <p className="text-sm text-text-secondary">{t("bisect.startHint")}</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary w-24 shrink-0">
                {t("bisect.badLabel")}
              </label>
              <input
                type="text"
                value={bad}
                onChange={(e) => setBad(e.target.value)}
                placeholder={t("bisect.hashPlaceholder")}
                className="input text-xs py-1.5 font-mono flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary w-24 shrink-0">
                {t("bisect.goodLabel")}
              </label>
              <input
                type="text"
                value={good}
                onChange={(e) => setGood(e.target.value)}
                placeholder={t("bisect.goodPlaceholder")}
                className="input text-xs py-1.5 font-mono flex-1"
              />
            </div>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={busy || !bad.trim()}
              onClick={start}
            >
              {busy && <SpinnerIcon size={13} />}
              {t("bisect.start")}
            </button>
          </div>
        )}

        {state && state.in_progress && (
          <div className="max-w-xl space-y-3">
            <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              {t("bisect.inProgress")}
            </div>
            <div className="rounded border border-border bg-bg-surface px-3 py-2.5">
              <div className="text-xs text-text-muted">{t("bisect.current")}</div>
              <div className="font-mono text-sm text-text-primary break-all">
                {state.current_commit || "—"}
              </div>
            </div>
            <p className="text-xs text-text-secondary">{t("bisect.testHint")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => mark("bad")}>
                {t("bisect.markBad")}
              </button>
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => mark("good")}>
                {t("bisect.markGood")}
              </button>
              <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => mark("skip")}>
                {t("bisect.markSkip")}
              </button>
              <button type="button" className="btn-ghost text-xs text-danger" disabled={busy} onClick={() => void reset()}>
                {t("bisect.reset")}
              </button>
            </div>
            <div>
              <button
                type="button"
                className="text-xs text-text-muted hover:text-text-secondary underline"
                onClick={() => setShowLog((v) => !v)}
                aria-expanded={showLog}
              >
                {showLog ? t("bisect.hideLog") : t("bisect.showLog")}
              </button>
              {showLog && (
                <pre className="mt-2 text-2xs font-mono text-text-secondary bg-bg-surface border border-border rounded p-3 max-h-72 overflow-auto whitespace-pre-wrap">
                  {state.log}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
