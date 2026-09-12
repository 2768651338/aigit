import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContributorInsights } from "@/types";

export function DeveloperActivityHeatmap({ contributors }: { contributors: ContributorInsights[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const person = contributors[selected];
  const max = Math.max(1, ...(person?.activity || [0]));
  return <section className="rounded-lg border border-border bg-bg-surface p-4"><div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-medium">{t("insights.heatmapTitle")}</h2><select className="bg-bg-base border border-border rounded px-2 py-1 text-xs" value={selected} onChange={(e) => setSelected(Number(e.target.value))} aria-label={t("insights.selectDeveloper")}>{contributors.map((c, i) => <option value={i} key={`${c.email}-${i}`}>{c.name}</option>)}</select></div>{!person ? <p className="text-sm text-text-muted">{t("insights.noDevelopers")}</p> : <><div className="grid grid-cols-7 gap-1 max-w-md" role="img" aria-label={t("insights.heatmapAria", { name: person.name })}>{Array.from({ length: 168 }, (_, i) => { const count = person.activity[i] || 0; return <span key={i} title={t("insights.hourCell", { day: Math.floor(i / 24) + 1, hour: i % 24, count })} className={`h-3 rounded-sm insight-level-${count ? Math.min(4, Math.ceil(count / max * 4)) : 0}`} />; })}</div><div className="mt-4 space-y-2">{contributors.slice(0, 5).map((c, i) => <button type="button" key={`${c.email}-${i}`} onClick={() => setSelected(i)} className="w-full flex justify-between text-sm hover:text-accent"><span>{c.name}</span><span className="text-text-muted">{t("insights.commitsActiveDays", { commits: c.commit_count, days: c.active_days })}</span></button>)}</div></>}</section>;
}
