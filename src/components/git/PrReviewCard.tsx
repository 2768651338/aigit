import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useAiStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { githubService } from "@/services/github";
import { confirmDialog, showMessage } from "@/utils/dialog";
import { formatError } from "@/utils/error";
import { severityClasses } from "@/utils/reviewSeverity";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { ScanSearchIcon, SpinnerIcon, XIcon } from "@/components/common/Icons";
import type { ReviewFinding } from "@/types";

/**
 * Pull Request 详情页内嵌的 AI 审查卡片：运行/重跑 PR 审查、展示 findings、
 * 逐条或一键发布行内评论。发布走既有单条评论端点（PAT），每条都经过
 * 后端的报告时效与 PR head 校验。
 */
export function PrReviewCard({ repoPath, pullNumber }: { repoPath: string; pullNumber: number }) {
  const { t } = useTranslation();
  const toast = useToastStore();
  const report = useAiStore((s) => {
    const saved = s.prReviewByRepo[repoPath] ?? null;
    return saved && saved.pull_number === pullNumber ? saved : null;
  });
  const loading = useAiStore((s) => Boolean(s.activeRequestByScope?.[`${repoPath}\u0000pr-review`]));
  const cancelTask = useAiStore((s) => s.cancelTask ?? (async () => undefined));
  const reviewPullRequest = useAiStore((s) => s.reviewPullRequest);
  const updateFindingStatus = useAiStore((s) => s.updatePrFindingStatus);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // 可发布 = 带行号的发现（后端还会校验该行是 PR diff 右侧可评论行）。
  const publishable = useMemo(
    () => (report?.findings ?? []).filter((finding) => finding.line),
    [report?.findings],
  );

  const run = async () => {
    try { await reviewPullRequest(repoPath, pullNumber); } catch { /* store 已提示失败 */ }
  };

  const publishOne = async (finding: ReviewFinding) => {
    if (!report || !finding.line) return;
    const confirmed = await confirmDialog(
      t("review.publishTitle"),
      t("review.publishConfirm", { file: finding.file, line: finding.line, title: finding.title }),
      "warning",
    );
    if (!confirmed) return;
    try {
      await githubService.publishInlineComment(repoPath, {
        pull_number: pullNumber,
        report_id: report.id,
        finding_id: finding.id,
        confirmed: true,
        pull_review: true,
      });
      toast.success(t("review.published"));
    } catch (error) {
      toast.error(formatError(error), t("review.publishFailed"));
    }
  };

  // 一键全部：一次确认后顺序逐条发布；单条失败不影响其余，结束后汇总展示。
  const publishAll = async () => {
    if (!report || publishing) return;
    if (publishable.length === 0) {
      toast.info(t("pullRequests.publishAllNone"));
      return;
    }
    const confirmed = await confirmDialog(
      t("pullRequests.publishAllTitle"),
      t("pullRequests.publishAllConfirm", { count: publishable.length, number: pullNumber }),
      "warning",
    );
    if (!confirmed) return;
    setPublishing(true);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const [index, finding] of publishable.entries()) {
        setProgress({ current: index + 1, total: publishable.length });
        try {
          await githubService.publishInlineComment(repoPath, {
            pull_number: pullNumber,
            report_id: report.id,
            finding_id: finding.id,
            confirmed: true,
            pull_review: true,
          });
          ok += 1;
        } catch (error) {
          failures.push(`${finding.file}:${finding.line} — ${formatError(error)}`);
        }
      }
      toast.info(t("pullRequests.publishAllDone", { ok, failed: failures.length }));
      if (failures.length > 0) {
        void showMessage(
          t("pullRequests.publishAllTitle"),
          t("pullRequests.publishAllFailures", { failed: failures.length }) + "\n\n" + failures.join("\n"),
          "warning",
        );
      }
    } finally {
      setPublishing(false);
      setProgress(null);
    }
  };

  const runButton = (
    <button
      className="btn-secondary text-xs"
      onClick={() => void run()}
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? <XIcon size={12} /> : <ScanSearchIcon size={12} />}
      {report ? t("pullRequests.aiReviewAgain") : t("pullRequests.aiReview")}
    </button>
  );

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold">{t("pullRequests.reviewSection")}</h3>
        <div className="flex-1" />
        {report && !report.fallback && (
          <button
            className="btn-ghost text-xs"
            onClick={() => void publishAll()}
            disabled={publishing || report.stale}
          >
            {publishing && progress
              ? t("pullRequests.publishingAll", { current: progress.current, total: progress.total })
              : t("pullRequests.publishAll")}
          </button>
        )}
        {report && runButton}
      </div>
      {loading && (
        <div className="flex items-center gap-3 py-2">
          <SpinnerIcon size={16} className="text-accent" />
          <p className="text-sm text-text-secondary">{t("review.analyzing")}</p>
          <div className="flex-1" />
          <button className="btn-secondary text-xs" onClick={() => void cancelTask(repoPath, "pr-review")}>
            {t("review.stop")}
          </button>
        </div>
      )}
      {!loading && !report && (
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <ScanSearchIcon size={20} />
          <p className="flex-1">{t("pullRequests.reviewEmpty")}</p>
          {runButton}
        </div>
      )}
      {!loading && report && (
        <>
          {report.stale && (
            <div role="alert" className="border border-warning/40 bg-warning/10 text-warning rounded px-3 py-2 text-sm mb-3">
              {t("pullRequests.reviewStale")}
            </div>
          )}
          {report.fallback && report.raw_markdown ? (
            <div className="prose prose-invert max-w-none">
              <p className="text-warning text-sm">{t("review.fallback")}</p>
              <MarkdownRenderer content={report.raw_markdown} />
            </div>
          ) : (
            <>
              <div className="bg-bg-elevated rounded p-3 mb-3">
                <p className="text-sm">{report.summary}</p>
                <p className="text-xs text-text-muted mt-2">{report.head_hash?.slice(0, 7)} · {report.generated_at}</p>
              </div>
              {report.findings.length === 0 && <p className="text-sm text-text-muted">{t("review.noFindings")}</p>}
              <div className="divide-y divide-border">
                {report.findings.map((finding) => (
                  <article key={finding.id} className="py-3 space-y-2">
                    <div className="flex gap-2 items-start flex-wrap">
                      <span className={clsx("px-2 py-0.5 rounded text-2xs font-semibold uppercase", severityClasses[finding.severity])}>
                        {t(`review.severities.${finding.severity}`)}
                      </span>
                      <span className="text-xs text-text-muted">{finding.category} · {Math.round(finding.confidence * 100)}%</span>
                      <div className="flex-1" />
                      <span className="text-xs text-text-muted font-mono">{finding.file}{finding.line ? `:${finding.line}` : ""}</span>
                    </div>
                    <h4 className="font-medium text-sm">{finding.title}</h4>
                    <p className="text-sm text-text-secondary">{finding.description}</p>
                    <div className="bg-bg-elevated rounded p-3 text-sm">
                      <b>{t("review.suggestion")}</b>
                      <p className="mt-1 whitespace-pre-wrap">{finding.suggestion}</p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => void publishOne(finding)}
                        disabled={!finding.line || report.stale || publishing}
                      >
                        {t("review.publishInline")}
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => void updateFindingStatus(repoPath, pullNumber, finding.id, "resolved")}
                      >
                        {t("review.resolve")}
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => void updateFindingStatus(repoPath, pullNumber, finding.id, "false_positive")}
                      >
                        {t("review.markFalsePositive")}
                      </button>
                      {finding.status !== "open" && (
                        <span className="text-xs text-text-muted self-center">
                          {t(finding.status === "resolved" ? "review.resolved" : "review.falsePositive")}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
