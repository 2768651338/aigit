import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { applyAuthorAliases, branchCounts, getAuthorAliasRules, saveAuthorAliasRules } from "@/utils/insights";
import { ContributionCalendar } from "@/components/insights/ContributionCalendar";
import { DeveloperActivityHeatmap } from "@/components/insights/DeveloperActivityHeatmap";
import { ProgressTimeline } from "@/components/insights/ProgressTimeline";
import { IdentityMergeDialog } from "@/components/insights/IdentityMergeDialog";
import { ReportGenerator } from "@/components/insights/ReportGenerator";
import { RefreshIcon, SpinnerIcon } from "@/components/common/Icons";
import type { RepositoryInsights } from "@/types";

type RangePreset = "7" | "30" | "90" | "all" | "custom";
type InsightDateRange = { startDate?: string; endDate?: string };

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetDates(preset: RangePreset): InsightDateRange {
  if (preset === "all" || preset === "custom") return {};
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (Number(preset) - 1));
  return { startDate: localDate(start), endDate: localDate(end) };
}

export function InsightsView() {
  const { t } = useTranslation();
  const { currentPath } = useRepoStore();
  const { config } = useSettingsStore();
  const toast = useToastStore();
  const [data, setData] = useState<RepositoryInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [preset, setPreset] = useState<RangePreset>("30");
  const initialRange = presetDates("30");
  const [startDate, setStartDate] = useState(initialRange.startDate || "");
  const [endDate, setEndDate] = useState(initialRange.endDate || "");

  const load = async (range: InsightDateRange = { startDate: startDate || undefined, endDate: endDate || undefined }) => {
    if (!currentPath || loading) return;
    setLoading(true);
    setError(null);
    try {
      setData(await gitService.getRepositoryInsights(currentPath, range.startDate, range.endDate));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setData(null);
    if (currentPath) void load({ startDate: initialRange.startDate, endDate: initialRange.endDate });
  }, [currentPath]);

  const selectPreset = (next: RangePreset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = presetDates(next);
    setStartDate(range.startDate || "");
    setEndDate(range.endDate || "");
    void load(range);
  };
  const applyCustom = () => {
    if (startDate && endDate && startDate > endDate) {
      toast.error(t("insights.invalidRange"));
      return;
    }
    setPreset("custom");
    void load({ startDate: startDate || undefined, endDate: endDate || undefined });
  };
  const repoId = currentPath || "";
  const rules = useMemo(() => currentPath ? getAuthorAliasRules(currentPath) : [], [currentPath, mergeOpen]);
  const contributors = useMemo(() => data ? applyAuthorAliases(data.contributors, rules) : [], [data, rules]);
  const branches = data ? branchCounts(data) : { total: 0, local: 0, remote: 0 };
  const handleMerge = (newRules: { email: string; display_name: string }[]) => {
    saveAuthorAliasRules(repoId, [...rules.filter((r) => !newRules.some((n) => n.email === r.email)), ...newRules]);
    setMergeOpen(false);
    toast.success(t("insights.identityMerged"));
  };

  if (!currentPath) return <div className="flex h-full items-center justify-center text-sm text-text-muted">{t("insights.openRepo")}</div>;
  if (loading && !data) return <div className="flex h-full items-center justify-center gap-2 text-sm text-text-muted"><SpinnerIcon size={16} />{t("insights.loading")}</div>;
  if (error && !data) return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-text-muted"><p>{t("insights.error")}: {error}</p><button type="button" onClick={() => void load()} className="rounded bg-accent px-3 py-1.5 text-white">{t("insights.retry")}</button></div>;

  return <div className="flex h-full flex-col overflow-hidden">
    <header className="border-b border-border px-6 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-semibold">{t("insights.title")}</h1><p className="text-xs text-text-muted">{data?.repository_name || ""}{data ? ` · ${data.start_date || "—"} — ${data.end_date || "—"}` : ""}</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => setMergeOpen(true)} disabled={!data?.contributors.length} className="text-xs text-text-secondary disabled:opacity-50">{t("insights.mergeIdentity")}</button><button type="button" onClick={() => void load()} disabled={loading} aria-label={t("insights.refresh")}><RefreshIcon size={16} /></button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label={t("insights.dateRange")}>
        {(["7", "30", "90", "all"] as const).map((value) => <button key={value} type="button" onClick={() => selectPreset(value)} className={`rounded border px-2 py-1 text-xs ${preset === value ? "border-accent text-accent" : "border-border text-text-muted"}`}>{t(`insights.range${value === "all" ? "All" : value}`)}</button>)}
        <button type="button" onClick={() => setPreset("custom")} className={`rounded border px-2 py-1 text-xs ${preset === "custom" ? "border-accent text-accent" : "border-border text-text-muted"}`}>{t("insights.rangeCustom")}</button>
        {preset === "custom" && <><input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} aria-label={t("insights.startDate")} className="rounded border border-border bg-bg-base px-2 py-1 text-xs" /><span className="text-text-muted">—</span><input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} aria-label={t("insights.endDate")} className="rounded border border-border bg-bg-base px-2 py-1 text-xs" /><button type="button" onClick={applyCustom} className="rounded bg-accent px-2 py-1 text-xs text-white">{t("insights.applyRange")}</button></>}
        {loading && <SpinnerIcon size={14} />}
      </div>
    </header>
    {!data || data.total_commits === 0 ? <div className="flex flex-1 items-center justify-center text-sm text-text-muted">{t("insights.emptyRange")}</div> : <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[["insights.commits", data.total_commits], ["insights.contributors", contributors.length], ["insights.localBranches", branches.local], ["insights.remoteBranches", branches.remote], ["insights.tags", data.tag_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border bg-bg-surface p-3"><div className="text-xs text-text-muted">{t(String(label))}</div><div className="text-xl font-semibold mt-1">{value}</div></div>)}</div>
      <ContributionCalendar values={data.daily_contributions} />
      <div className="grid gap-4 lg:grid-cols-2"><DeveloperActivityHeatmap contributors={contributors} /><ProgressTimeline timeline={data.timeline} milestones={data.milestones} /></div>
      <ReportGenerator insights={{ ...data, contributors }} config={config} repoPath={currentPath} />
    </div>}
    <IdentityMergeDialog open={mergeOpen} contributors={data?.contributors || []} onClose={() => setMergeOpen(false)} onSave={handleMerge} />
  </div>;
}
