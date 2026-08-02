import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig, RepositoryInsights } from "@/types";
import { aiService } from "@/services/ai";
import { exportInsights } from "@/utils/exportInsights";
import { generateProjectIntroduction, generateWeeklyReport, type InsightReportLabels } from "@/utils/insights";

export function ReportGenerator({ insights, config, repoPath }: { insights: RepositoryInsights; config: AppConfig | null; repoPath?: string }) {
  const { t } = useTranslation();
  const labels = useMemo<InsightReportLabels>(() => ({
    weeklyTitle: t("insights.report.weeklyTitle"),
    projectSummary: t("insights.report.projectSummary"),
    period: t("insights.period"),
    commits: t("insights.commits"),
    contributors: t("insights.contributors"),
    branches: t("insights.branches"),
    localBranches: t("insights.localBranches"),
    remoteBranches: t("insights.remoteBranches"),
    commitSummary: t("insights.report.commitSummary"),
    noCommits: t("insights.report.noCommits"),
    noContributors: t("insights.report.noContributors"),
    projectDescription: t("insights.report.projectDescription"),
  }), [t]);
  const [kind, setKind] = useState<"week" | "intro">("week");
  const [content, setContent] = useState(() => generateWeeklyReport(insights, labels));
  const [working, setWorking] = useState(false);
  const generate = (next: "week" | "intro") => {
    setKind(next);
    setContent(next === "week" ? generateWeeklyReport(insights, labels) : generateProjectIntroduction(insights, labels));
  };
  useEffect(() => {
    setContent(kind === "week" ? generateWeeklyReport(insights, labels) : generateProjectIntroduction(insights, labels));
  }, [insights, labels]);
  const polish = async () => {
    if (!config) return;
    setWorking(true);
    try {
      const redact = (value: string) => value
        .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+\b/gi, t("insights.report.redactedCredential"))
        .replace(/\b(?:password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, `$1=${t("insights.report.redacted")}`)
        .replace(/(?:[A-Za-z]:\\|\\\\)[^\n\r`]+/g, t("insights.report.redactedPath"));
      const safe = {
        repository: redact(insights.repository_name),
        start_date: insights.start_date,
        end_date: insights.end_date,
        total_commits: insights.total_commits,
        contributor_count: insights.contributor_count,
        branch_count: insights.branch_count,
        local_branch_count: insights.local_branch_count,
        remote_branch_count: insights.remote_branch_count,
        tag_count: insights.tag_count,
        recent_commits: insights.recent_commits.map(({ author, date, message }) => ({
          author: redact(author), date, message: redact(message).slice(0, 500),
        })),
      };
      const prompt = [
        t("insights.report.polishPrompt"),
        `<untrusted>${JSON.stringify(safe)}</untrusted>`,
        `<untrusted>${redact(content).slice(0, 12000)}</untrusted>`,
      ].join("\n");
      const response = await aiService.repoChat([{ role: "user", content: prompt }], repoPath);
      setContent(response);
    } finally {
      setWorking(false);
    }
  };
  return <section className="rounded-lg border border-border bg-bg-surface p-4">
    <div className="flex flex-wrap gap-2 mb-3">
      <button type="button" onClick={() => generate("week")} className={kind === "week" ? "text-accent font-medium" : "text-text-muted"}>{t("insights.report.weeklyTitle")}</button>
      <button type="button" onClick={() => generate("intro")} className={kind === "intro" ? "text-accent font-medium" : "text-text-muted"}>{t("insights.report.projectSummary")}</button>
      <span className="flex-1" />
      <button type="button" onClick={() => navigator.clipboard?.writeText(content)} className="text-xs">{t("insights.report.copy")}</button>
      <button type="button" onClick={() => exportInsights({ format: "markdown", content, fileName: `${insights.repository_name}-${kind}-${insights.start_date || "all"}-${insights.end_date || "all"}.md` })} className="text-xs">{t("insights.report.exportMarkdown")}</button>
      <button type="button" disabled={!config || working} onClick={polish} className="text-xs rounded bg-accent px-2 py-1 text-white disabled:opacity-50">{working ? t("insights.report.polishing") : t("insights.report.polish")}</button>
    </div>
    <textarea value={content} onChange={(e) => setContent(e.target.value)} className="w-full min-h-48 bg-bg-base border border-border rounded p-3 text-sm font-mono" aria-label={t("insights.report.content")} />
  </section>;
}
