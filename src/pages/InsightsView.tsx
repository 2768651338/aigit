import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { applyAuthorAliases, getAuthorAliasRules, saveAuthorAliasRules } from "@/utils/insights";
import { ContributionCalendar } from "@/components/insights/ContributionCalendar";
import { DeveloperActivityHeatmap } from "@/components/insights/DeveloperActivityHeatmap";
import { ProgressTimeline } from "@/components/insights/ProgressTimeline";
import { IdentityMergeDialog } from "@/components/insights/IdentityMergeDialog";
import { ReportGenerator } from "@/components/insights/ReportGenerator";
import { RefreshIcon, SpinnerIcon } from "@/components/common/Icons";
import type { RepositoryInsights } from "@/types";

export function InsightsView() {
  const { t } = useTranslation(); const { currentPath } = useRepoStore(); const { config } = useSettingsStore(); const toast = useToastStore();
  const [data, setData] = useState<RepositoryInsights | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [mergeOpen, setMergeOpen] = useState(false);
  const load = async () => { if (!currentPath || loading) return; setLoading(true); setError(null); try { setData(await gitService.getRepositoryInsights(currentPath)); } catch (e) { setError(formatError(e)); } finally { setLoading(false); } };
  useEffect(() => { setData(null); if (currentPath) void load(); }, [currentPath]);
  const repoId = currentPath || ""; const rules = useMemo(() => currentPath ? getAuthorAliasRules(currentPath) : [], [currentPath, mergeOpen]);
  const contributors = useMemo(() => data ? applyAuthorAliases(data.contributors, rules) : [], [data, rules]);
  const handleMerge = (newRules: { email: string; display_name: string }[]) => { saveAuthorAliasRules(repoId, [...rules.filter((r) => !newRules.some((n) => n.email === r.email)), ...newRules]); setMergeOpen(false); toast.success("开发者身份已合并"); };
  if (!currentPath) return <div className="flex h-full items-center justify-center text-sm text-text-muted">{t("insights.openRepo")}</div>;
  if (loading && !data) return <div className="flex h-full items-center justify-center gap-2 text-sm text-text-muted"><SpinnerIcon size={16} />{t("insights.loading")}</div>;
  if (error && !data) return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-muted"><p>{t("insights.error")}: {error}</p><button type="button" onClick={() => void load()} className="rounded bg-accent px-3 py-1.5 text-white">{t("insights.retry")}</button></div>;
  if (!data || data.total_commits === 0) return <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-text-muted"><p>{t("insights.empty")}</p><button type="button" onClick={() => void load()}><RefreshIcon size={16} /></button></div>;
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex items-center justify-between border-b border-border px-6 py-4"><div><h1 className="text-lg font-semibold">{t("insights.title")}</h1><p className="text-xs text-text-muted">{data.repository_name} · {data.start_date} — {data.end_date}</p></div><div className="flex gap-2"><button type="button" onClick={() => setMergeOpen(true)} className="text-xs text-text-secondary">{t("insights.mergeIdentity")}</button><button type="button" onClick={() => void load()} disabled={loading} aria-label={t("insights.refresh")}><RefreshIcon size={16} /></button></div></header><div className="flex-1 overflow-auto p-6 space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[["insights.commits", data.total_commits], ["insights.contributors", contributors.length], ["insights.branches", data.branch_count], ["insights.tags", data.tag_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border bg-bg-surface p-3"><div className="text-xs text-text-muted">{t(String(label))}</div><div className="text-xl font-semibold mt-1">{value}</div></div>)}</div><ContributionCalendar values={data.daily_contributions} /><div className="grid gap-4 lg:grid-cols-2"><DeveloperActivityHeatmap contributors={contributors} /><ProgressTimeline timeline={data.timeline} milestones={data.milestones} /></div><ReportGenerator insights={{ ...data, contributors }} config={config} repoPath={currentPath} /></div><IdentityMergeDialog open={mergeOpen} contributors={data.contributors} onClose={() => setMergeOpen(false)} onSave={handleMerge} /></div>;
}
