import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InsightMilestone, TimelineBucket } from "@/types";
import { PlayIcon, PauseIcon, RotateCcwIcon } from "@/components/common/Icons";
import { createTimelineFrames } from "@/utils/insights";
import { exportInsights, makeExportFileName, serializeSvg } from "@/utils/exportInsights";
import { useToastStore } from "@/stores/toastStore";

export function ProgressTimeline({ timeline, milestones = [] }: { timeline: TimelineBucket[]; milestones?: InsightMilestone[] }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [index, setIndex] = useState(Math.max(0, timeline.length - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setIndex(Math.max(0, timeline.length - 1)); setPlaying(false); }, [timeline]);
  useEffect(() => {
    if (!playing || !timeline.length) return;
    const timer = window.setInterval(() => setIndex((value) => {
      if (value >= timeline.length - 1) { setPlaying(false); return value; }
      return value + 1;
    }), 900 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, timeline.length]);
  const current = timeline[index];
  const max = Math.max(1, ...timeline.map((bucket) => bucket.cumulative_commits));
  const pointsFor = (last: number) => timeline.slice(0, last + 1).map((bucket, i) =>
    `${i / Math.max(1, timeline.length - 1) * 100},${100 - bucket.cumulative_commits / max * 85}`
  ).join(" ");
  const runExport = async (format: "svg" | "png" | "gif") => {
    if (exporting || !timeline.length || !svgRef.current) return;
    setExporting(true);
    try {
      const source = serializeSvg(svgRef.current);
      const frames = format === "gif" ? createTimelineFrames(timeline).map((bucket) => {
        const document = new DOMParser().parseFromString(source, "image/svg+xml");
        document.querySelector("[data-timeline-active]")?.setAttribute("points", pointsFor(timeline.indexOf(bucket)));
        return { svg: new XMLSerializer().serializeToString(document.documentElement) };
      }) : undefined;
      const path = await exportInsights({ format, svg: source, frames, frameRate: 8, fileName: makeExportFileName("repository", "timeline", format) });
      if (path) useToastStore.getState().success(t("insights.exportSuccess", { format: format.toUpperCase() }));
    } catch (error) {
      useToastStore.getState().error(error instanceof Error ? error.message : t("insights.exportFailed"));
    } finally { setExporting(false); }
  };
  return <section className="rounded-lg border border-border bg-bg-surface p-4">
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-medium">{t("insights.timelineTitle")}</h2>
      <div className="flex gap-2">
        <button type="button" onClick={() => { if (!playing && index >= timeline.length - 1) setIndex(0); setPlaying((value) => !value); }} aria-label={playing ? t("insights.pause") : t("insights.play")}>{playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}</button>
        <button type="button" onClick={() => { setIndex(0); setPlaying(false); }} aria-label={t("insights.replay")}><RotateCcwIcon size={14} /></button>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="bg-bg-base rounded text-xs" aria-label={t("insights.playbackSpeed")}><option value="0.5">0.5x</option><option value="1">1x</option><option value="2">2x</option></select>
        {(["svg", "png", "gif"] as const).map((format) => <button key={format} type="button" disabled={exporting || !timeline.length} onClick={() => void runExport(format)} className="text-xs rounded px-2 py-1 disabled:opacity-50">{exporting ? t("common.loading") : format.toUpperCase()}</button>)}
      </div>
    </div>
    {!timeline.length ? <p className="text-sm text-text-muted">{t("insights.noTimeline")}</p> : <>
      <svg ref={svgRef} viewBox="0 0 100 100" width="1200" height="480" className="w-full h-40" role="img" aria-label={t("insights.timelineAria")}>
        <polyline points={pointsFor(timeline.length - 1)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted" opacity="0.25" />
        <polyline data-timeline-active="true" points={pointsFor(index)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
        {milestones.map((milestone, i) => <text key={`${milestone.hash}-${milestone.name}`} x="2" y={8 + i * 4} className="fill-text-muted text-[3px]">{milestone.name}</text>)}
      </svg>
      <input className="w-full" type="range" min="0" max={timeline.length - 1} value={index} onChange={(event) => { setIndex(Number(event.target.value)); setPlaying(false); }} aria-label={t("insights.timelineProgress")} />
      <p className="text-xs text-text-muted">{t("insights.timelineSummary", { period: current?.period ?? "", commits: current?.cumulative_commits ?? 0, contributors: current?.cumulative_contributors ?? 0 })}</p>
    </>}
  </section>;
}
