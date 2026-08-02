import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { ScanSearchIcon, SpinnerIcon, XIcon } from "@/components/common/Icons";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { githubService } from "@/services/github";
import { useToastStore } from "@/stores/toastStore";
import { confirmDialog } from "@/utils/dialog";
import { formatError } from "@/utils/error";
import type { FindingStatus, ReviewFinding, ReviewSeverity } from "@/types";

const severities: ReviewSeverity[] = ["critical", "high", "medium", "low", "info"];
const severityClasses: Record<ReviewSeverity, string> = {
  critical: "bg-danger/20 text-danger",
  high: "bg-danger/15 text-danger",
  medium: "bg-warning/20 text-warning",
  low: "bg-accent/15 text-accent",
  info: "bg-bg-hover text-text-secondary",
};

export function ReviewView({ onNavigateChanges }: { onNavigateChanges: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const selectFile = useRepoStore((s) => s.selectFile);
  const reviewCode = useAiStore((s) => s.reviewCode);
  const loadReview = useAiStore((s) => s.loadReview);
  const updateFindingStatus = useAiStore((s) => s.updateFindingStatus);
  const loading = useAiStore((s) => currentPath ? Boolean(s.activeRequestByScope?.[`${currentPath}\u0000review`]) : false);
  const cancelTask = useAiStore((s) => s.cancelTask ?? (async () => undefined));
  const streamedResult = useAiStore((s) => currentPath ? s.lastResultByRepo?.[currentPath] ?? "" : "");
  const report = useAiStore((s) => currentPath ? s.reviewByRepo[currentPath] ?? null : null);
  const { config } = useSettingsStore();
  const toast = useToastStore();
  const [reviewScope, setReviewScope] = useState<"all" | "staged">("staged");
  const [reviewedFile, setReviewedFile] = useState<string | undefined>();
  const [severity, setSeverity] = useState<ReviewSeverity | "all">("all");
  const [status, setStatus] = useState<FindingStatus | "all">("open");

  const statusFingerprint = useMemo(
    () => fileStatuses.map((file) => `${file.path}\u0000${file.old_path ?? ""}\u0000${file.status}\u0000${file.staged}`).sort().join("\u0001"),
    [fileStatuses],
  );

  useEffect(() => {
    if (currentPath) void loadReview(currentPath);
  }, [currentPath, repoInfo?.head_hash, statusFingerprint, loadReview]);

  const findingsByFile = useMemo(() => {
    const grouped = new Map<string, ReviewFinding[]>();
    for (const finding of report?.findings ?? []) {
      if ((severity !== "all" && finding.severity !== severity) || (status !== "all" && finding.status !== status)) continue;
      const findings = grouped.get(finding.file) ?? [];
      findings.push(finding);
      grouped.set(finding.file, findings);
    }
    return [...grouped.entries()];
  }, [report?.findings, severity, status]);

  const handleReview = async () => {
    if (!currentPath || !config) return;
    try { await reviewCode(currentPath, reviewedFile, reviewScope === "staged"); } catch { /* store shows failure */ }
  };
  const updateStatus = (findingId: string, next: FindingStatus) => {
    if (currentPath) void updateFindingStatus(currentPath, findingId, next);
  };
  const jumpToFinding = async (finding: ReviewFinding) => {
    await selectFile(finding.file);
    onNavigateChanges();
    requestAnimationFrame(() => {
      document.querySelector(`[data-diff-line="${finding.line ?? ""}"]`)?.scrollIntoView({ block: "center" });
    });
  };
  const copySuggestion = async (suggestion: string) => {
    try { await navigator.clipboard.writeText(suggestion); } catch { /* clipboard permission is optional */ }
  };
  const publishFinding = async (finding: ReviewFinding) => {
    if (!currentPath || !report?.head_hash || !finding.line) return;
    const pullNumber = Number(window.prompt(t("review.pullNumberPrompt")));
    if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) return;
    const confirmed = await confirmDialog(
      t("review.publishTitle"),
      t("review.publishConfirm", { file: finding.file, line: finding.line, title: finding.title }),
      "warning",
    );
    if (!confirmed) return;
    try {
      await githubService.publishInlineComment(currentPath, {
        pull_number: pullNumber,
        report_id: report.id,
        finding_id: finding.id,
        confirmed: true,
      });
      toast.success(t("review.published"));
    } catch (error) {
      toast.error(formatError(error), t("review.publishFailed"));
    }
  };
  const exportMarkdown = () => {
    if (!report) return;
    const lines = [`# ${t("review.title")}`, "", report.summary, "", `- ${t("review.head")}: ${report.head_hash ?? "HEAD"}`, `- ${t("review.diffHash")}: ${report.diff_hash}`, ""];
    for (const finding of report.findings) {
      lines.push(`## [${finding.severity}] ${finding.title}`, `- ${finding.file}${finding.line ? `:${finding.line}` : ""}`, `- ${finding.category}`, "", finding.description, "", `**${t("review.suggestion")}**: ${finding.suggestion}`, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "aigit-review.md"; anchor.click(); URL.revokeObjectURL(url);
  };

  if (!currentPath) return <div className="flex items-center justify-center h-full text-text-muted text-sm">{t("review.openRepoHint")}</div>;

  return <div className="flex flex-col h-full">
    <div className="flex items-center px-5 h-12 border-b border-border gap-3">
      <h2 className="text-base font-semibold">{t("review.title")}</h2><div className="flex-1" />
      <div className="flex items-center gap-1 bg-bg-elevated rounded p-1">
        {(["staged", "all"] as const).map((scope) => <button key={scope} onClick={() => setReviewScope(scope)} className={clsx("px-3 py-1.5 text-xs rounded", reviewScope === scope ? "bg-bg-hover text-text-primary font-medium" : "text-text-secondary")}>{t(scope === "staged" ? "review.staged" : "review.allChanges")}</button>)}
      </div>
      <button onClick={() => loading ? void cancelTask(currentPath, "review") : void handleReview()} aria-busy={loading} className={loading ? "btn-secondary" : "btn-primary"}>{loading ? <XIcon size={14} /> : <ScanSearchIcon size={14} />}{loading ? t("review.stop") : t("review.runReview")}</button>
    </div>
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border">
      <span className="text-xs text-text-muted">{t("review.file")}</span><select value={reviewedFile ?? ""} onChange={(e) => setReviewedFile(e.target.value || undefined)} className="bg-bg-elevated border border-border rounded px-3 py-1.5 text-sm"><option value="">{t("review.allFiles")}</option>{fileStatuses.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}</select>
      <label className="text-xs text-text-muted">{t("review.severity")} <select value={severity} onChange={(e) => setSeverity(e.target.value as ReviewSeverity | "all")} className="bg-bg-elevated border border-border rounded px-2 py-1"><option value="all">{t("review.all")}</option>{severities.map((item) => <option key={item} value={item}>{t(`review.severities.${item}`)}</option>)}</select></label>
      <label className="text-xs text-text-muted">{t("review.status")} <select value={status} onChange={(e) => setStatus(e.target.value as FindingStatus | "all")} className="bg-bg-elevated border border-border rounded px-2 py-1"><option value="all">{t("review.all")}</option><option value="open">{t("review.open")}</option><option value="resolved">{t("review.resolved")}</option><option value="false_positive">{t("review.falsePositive")}</option></select></label>
      {report && <button onClick={exportMarkdown} className="btn-ghost text-xs ml-auto">{t("review.exportMarkdown")}</button>}
      <span className="text-xs text-text-muted">{t("review.provider", { provider: config?.ai.active_provider ?? "" })}</span>
    </div>
    <div className="flex-1 overflow-auto p-6">
      {loading && <div className="max-w-5xl mx-auto space-y-3"><div className="flex items-center gap-3"><SpinnerIcon size={18} className="text-accent" /><p className="text-sm text-text-secondary">{t("review.analyzing")}</p></div>{streamedResult && <div className="prose prose-invert max-w-none"><MarkdownRenderer content={streamedResult} /></div>}</div>}
      {!loading && !report && <div className="flex flex-col items-center justify-center py-16 text-center"><ScanSearchIcon size={48} className="text-text-muted mb-4" /><p className="text-sm text-text-secondary max-w-md">{t("review.emptyHint")}</p></div>}
      {!loading && report && <section className="max-w-5xl mx-auto space-y-4">
        {report.stale && <div role="alert" className="border border-warning/40 bg-warning/10 text-warning rounded px-4 py-3 text-sm">{t("review.stale")}</div>}
        <div className="bg-bg-surface border border-border rounded p-4"><p className="text-sm">{report.summary}</p><p className="text-xs text-text-muted mt-2">{report.head_hash ?? "HEAD"} · {report.generated_at}</p></div>
        {report.fallback && report.raw_markdown && <div className="prose prose-invert max-w-none bg-bg-surface border border-border rounded p-4"><p className="text-warning text-sm">{t("review.fallback")}</p><MarkdownRenderer content={report.raw_markdown} /></div>}
        {!report.fallback && findingsByFile.length === 0 && <p className="text-sm text-text-muted">{t("review.noFindings")}</p>}
        {findingsByFile.map(([file, findings]) => <section key={file} className="border border-border rounded overflow-hidden"><h3 className="px-4 py-2 bg-bg-elevated font-mono text-sm">{file} <span className="text-text-muted">({findings.length})</span></h3><div className="divide-y divide-border">{findings.map((finding) => <article key={finding.id} className="p-4 space-y-2"><div className="flex gap-2 items-start"><span className={clsx("px-2 py-0.5 rounded text-2xs font-semibold uppercase", severityClasses[finding.severity])}>{t(`review.severities.${finding.severity}`)}</span><span className="text-xs text-text-muted">{finding.category} · {Math.round(finding.confidence * 100)}%</span><div className="flex-1" /><button onClick={() => jumpToFinding(finding)} className="btn-ghost text-xs">{finding.line ? `:${finding.line}` : t("review.openDiff")}</button></div><h4 className="font-medium text-sm">{finding.title}</h4><p className="text-sm text-text-secondary">{finding.description}</p><div className="bg-bg-elevated rounded p-3 text-sm"><b>{t("review.suggestion")}</b><p className="mt-1 whitespace-pre-wrap">{finding.suggestion}</p><button onClick={() => copySuggestion(finding.suggestion)} className="btn-ghost text-xs mt-2">{t("review.copySuggestion")}</button></div><div className="flex gap-2"><button onClick={() => publishFinding(finding)} disabled={!finding.line || report.stale} className="btn-ghost text-xs">{t("review.publishInline")}</button><button onClick={() => updateStatus(finding.id, "resolved")} className="btn-ghost text-xs">{t("review.resolve")}</button><button onClick={() => updateStatus(finding.id, "false_positive")} className="btn-ghost text-xs">{t("review.markFalsePositive")}</button></div></article>)}</div></section>)}
      </section>}
    </div>
  </div>;
}
