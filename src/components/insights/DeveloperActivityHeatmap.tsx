import { useState } from "react";
import type { ContributorInsights } from "@/types";

export function DeveloperActivityHeatmap({ contributors }: { contributors: ContributorInsights[] }) {
  const [selected, setSelected] = useState(0);
  const person = contributors[selected];
  const max = Math.max(1, ...(person?.activity || [0]));
  return <section className="rounded-lg border border-border bg-bg-surface p-4"><div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-medium">开发者活跃度</h2><select className="bg-bg-base border border-border rounded px-2 py-1 text-xs" value={selected} onChange={(e) => setSelected(Number(e.target.value))} aria-label="选择开发者">{contributors.map((c, i) => <option value={i} key={`${c.email}-${i}`}>{c.name}</option>)}</select></div>{!person ? <p className="text-sm text-text-muted">暂无开发者记录</p> : <><div className="grid grid-cols-7 gap-1 max-w-md" role="img" aria-label={`${person.name} 星期和小时活跃度热力图`}>{Array.from({ length: 168 }, (_, i) => { const count = person.activity[i] || 0; return <span key={i} title={`星期 ${Math.floor(i / 24) + 1}，${i % 24}:00，${count} 次`} className={`h-3 rounded-sm insight-level-${count ? Math.min(4, Math.ceil(count / max * 4)) : 0}`} />; })}</div><div className="mt-4 space-y-2">{contributors.slice(0, 5).map((c, i) => <button type="button" key={`${c.email}-${i}`} onClick={() => setSelected(i)} className="w-full flex justify-between text-sm hover:text-accent"><span>{c.name}</span><span className="text-text-muted">{c.commit_count} 次提交 · {c.active_days} 天活跃</span></button>)}</div></>}</section>;
}
