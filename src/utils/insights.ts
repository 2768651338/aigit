import type { AuthorAliasRule, ContributorInsights, DailyContribution, RepositoryInsights, TimelineBucket } from "@/types";

export const MAX_EXPORT_WIDTH = 2400;
export const MAX_EXPORT_HEIGHT = 1600;
export const MAX_GIF_FRAMES = 120;

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

export function applyAuthorAliases(contributors: ContributorInsights[], rules: AuthorAliasRule[]): ContributorInsights[] {
  const byEmail = new Map(rules.map((r) => [normalizeEmail(r.email), r.display_name.trim()]));
  const grouped = new Map<string, ContributorInsights>();
  for (const item of contributors) {
    const name = byEmail.get(normalizeEmail(item.email)) || item.name;
    const key = name.trim().toLocaleLowerCase();
    const existing = grouped.get(key);
    if (!existing) { grouped.set(key, { ...item, name }); continue; }
    existing.commit_count += item.commit_count;
    existing.active_days += item.active_days;
    existing.first_date = existing.first_date < item.first_date ? existing.first_date : item.first_date;
    existing.last_date = existing.last_date > item.last_date ? existing.last_date : item.last_date;
    existing.activity = existing.activity.map((v, i) => v + (item.activity[i] || 0));
  }
  return [...grouped.values()].sort((a, b) => b.commit_count - a.commit_count);
}

export function fillDateRange(values: DailyContribution[], start: string | Date, end: string | Date): DailyContribution[] {
  const map = new Map(values.map((v) => [v.date.slice(0, 10), v.count]));
  const result: DailyContribution[] = [];
  const cursor = new Date(start); const finish = new Date(end);
  cursor.setUTCHours(0, 0, 0, 0); finish.setUTCHours(0, 0, 0, 0);
  for (; cursor <= finish; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); result.push({ date, count: map.get(date) || 0 });
  }
  return result;
}

export function contributionIntensity(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

export function createTimelineFrames(timeline: TimelineBucket[], maxFrames = MAX_GIF_FRAMES): TimelineBucket[] {
  if (timeline.length <= maxFrames) return timeline.slice();
  const step = (timeline.length - 1) / (maxFrames - 1);
  return Array.from({ length: maxFrames }, (_, i) => timeline[Math.round(i * step)]);
}

export function sanitizeFileName(value: string, fallback = "insights"): string {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (safe || fallback).slice(0, 180);
}

export function getExportDimensions(width = 1200, height = 800, scale = 1): { width: number; height: number } {
  const factor = Math.max(0.1, scale); const ratio = Math.min(1, MAX_EXPORT_WIDTH / (width * factor), MAX_EXPORT_HEIGHT / (height * factor));
  return { width: Math.max(1, Math.floor(width * factor * ratio)), height: Math.max(1, Math.floor(height * factor * ratio)) };
}

export function getAuthorAliasRules(repoId: string): AuthorAliasRule[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`aigit:insight-aliases:${repoId}`) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((rule): rule is AuthorAliasRule => {
      if (!rule || typeof rule !== "object") return false;
      const item = rule as Record<string, unknown>;
      return typeof item.email === "string" && item.email.length <= 320
        && typeof item.display_name === "string" && item.display_name.trim().length > 0
        && item.display_name.length <= 160;
    }).map((rule) => ({ email: normalizeEmail(rule.email), display_name: rule.display_name.trim() }));
  } catch { return []; }
}
export function saveAuthorAliasRules(repoId: string, rules: AuthorAliasRule[]): void {
  const safeRepoId = repoId.slice(0, 1000);
  const safeRules = rules.filter((rule) => rule.email.length <= 320 && rule.display_name.trim().length <= 160);
  localStorage.setItem(`aigit:insight-aliases:${safeRepoId}`, JSON.stringify(safeRules));
}
export function resetAuthorAliasRules(repoId: string): void { localStorage.removeItem(`aigit:insight-aliases:${repoId}`); }

export function generateWeeklyReport(insights: RepositoryInsights, weekLabel = "最近一周"): string {
  const commits = insights.recent_commits.slice(0, 20);
  return `# ${insights.repository_name} 周报（${weekLabel}）\n\n- 提交数：${insights.total_commits}\n- 贡献者：${insights.contributor_count}\n- 活跃分支：${insights.branch_count}\n\n## 提交摘要\n${commits.length ? commits.map((c) => `- ${c.date} ${c.author}：${c.message}`).join("\n") : "- 暂无提交记录"}\n`;
}
export function generateProjectIntroduction(insights: RepositoryInsights): string {
  const top = insights.contributors.slice(0, 5).map((c) => c.name).join("、") || "暂无记录";
  return `# ${insights.repository_name}\n\n该项目共有 **${insights.total_commits}** 次提交，由 **${insights.contributor_count}** 位贡献者共同维护。主要贡献者：${top}。当前记录包含 ${insights.branch_count} 个分支和 ${insights.tag_count} 个版本标签。`;
}
