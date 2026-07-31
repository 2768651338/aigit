import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DailyContribution } from "@/types";
import { contributionIntensity, fillDateRange } from "@/utils/insights";
import { exportInsights, makeExportFileName } from "@/utils/exportInsights";
import { useToastStore } from "@/stores/toastStore";

export function ContributionCalendar({ values }: { values: DailyContribution[] }) {
  const { t } = useTranslation(); const toast = useToastStore(); const svgRef = useRef<SVGSVGElement>(null); const [exporting, setExporting] = useState(false);
  const range = useMemo(() => values.length ? fillDateRange(values, values[0].date, values[values.length - 1].date) : [], [values]);
  const max = Math.max(0, ...range.map((v) => v.count));
  const weeks = useMemo(() => { const result: DailyContribution[][] = []; range.forEach((value, index) => { const week = Math.floor(index / 7); (result[week] ||= []).push(value); }); return result; }, [range]);
  const runExport = async (format: "svg" | "png") => { if (exporting || !svgRef.current) return; setExporting(true); try { const path = await exportInsights({ format, svg: svgRef.current, fileName: makeExportFileName("repository", "contributions", format) }); if (path) toast.success(`${format.toUpperCase()} 导出成功`); } catch (e) { toast.error(e instanceof Error ? e.message : "导出失败"); } finally { setExporting(false); } };
  return <section className="rounded-lg border border-border bg-bg-surface p-4" aria-label="Contribution calendar">
    <div className="flex items-center justify-between mb-3"><h2 className="font-medium">贡献日历</h2><div className="flex items-center gap-2"><span className="text-xs text-text-muted">{range.reduce((n, v) => n + v.count, 0)} 次提交</span>{(["svg", "png"] as const).map((format) => <button key={format} type="button" disabled={exporting || !range.length} onClick={() => void runExport(format)} className="text-xs rounded border border-border px-2 py-1 disabled:opacity-50">{exporting ? t("common.loading") : format.toUpperCase()}</button>)}</div></div>
    {!range.length ? <p className="text-sm text-text-muted">暂无贡献记录</p> : <svg ref={svgRef} viewBox={`0 0 ${Math.max(260, weeks.length * 14 + 30)} 100`} className="w-full h-28" role="img" aria-label="每日提交贡献日历">{weeks.map((week, wi) => week.map((day, di) => <rect key={day.date} x={wi * 14} y={di * 13} width="10" height="10" rx="2" className={`insight-level-${contributionIntensity(day.count, max)}`}><title>{day.date}: {day.count}</title></rect>))}</svg>}
    <div className="flex gap-2 text-xs text-text-muted mt-2" aria-label="贡献强度图例"><span>少</span>{[0,1,2,3,4].map((v) => <span key={v} className={`inline-block w-3 h-3 rounded insight-level-${v}`} aria-label={`level ${v}`} />)}<span>多</span></div>
  </section>;
}
