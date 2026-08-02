import { describe, expect, it } from "vitest";
import { applyAuthorAliases, branchCounts, contributionIntensity, createTimelineFrames, fillDateRange, generateProjectIntroduction, generateWeeklyReport, insightPeriod, sanitizeFileName } from "./insights";
import type { ContributorInsights, RepositoryInsights } from "@/types";
import type { InsightReportLabels } from "./insights";

const labels: InsightReportLabels = {
  weeklyTitle: "周报", projectSummary: "项目介绍", period: "统计区间", commits: "提交数", contributors: "贡献者", branches: "分支", localBranches: "本地分支", remoteBranches: "远程分支", commitSummary: "提交摘要", noCommits: "暂无提交记录", noContributors: "暂无记录", projectDescription: "提交 {{commits}}，贡献者 {{contributors}}，主要贡献者 {{top}}，分支 {{branches}}，标签 {{tags}}。",
};

const contributor = (name: string, email: string, count: number): ContributorInsights => ({ name, email, commit_count: count, active_days: 1, first_date: "2024-01-01", last_date: "2024-01-01", activity: [count] });
const insights: RepositoryInsights = { repository_name: "demo", start_date: "2024-01-01", end_date: "2024-01-02", total_commits: 2, contributor_count: 1, branch_count: 5, local_branch_count: 2, remote_branch_count: 3, tag_count: 1, daily_contributions: [], contributors: [contributor("A", "a@example.com", 2)], timeline: [], milestones: [], recent_commits: [{ hash: "abc", author: "A", date: "2024-01-01", message: "initial" }] };

describe("insights utilities", () => {
  it("fills missing dates with zero and includes both boundaries", () => expect(fillDateRange([{ date: "2024-01-02", count: 2 }], "2024-01-01", "2024-01-03")).toEqual([{ date: "2024-01-01", count: 0 }, { date: "2024-01-02", count: 2 }, { date: "2024-01-03", count: 0 }]));
  it("groups aliases case-insensitively", () => expect(applyAuthorAliases([contributor("A", "A@EXAMPLE.COM", 2), contributor("B", "b@example.com", 3)], [{ email: "a@example.com", display_name: "Team" }, { email: "b@example.com", display_name: "Team" }])[0].commit_count).toBe(5));
  it("assigns intensity and caps timeline frames", () => { expect(contributionIntensity(0, 5)).toBe(0); expect(contributionIntensity(5, 5)).toBe(4); expect(createTimelineFrames(Array.from({ length: 10 }, (_, i) => ({ period: String(i), cumulative_commits: i, cumulative_contributors: 1, commits: 1, contributors: 1 })), 3)).toHaveLength(3); });
  it("generates reports from selected-range statistics and writes the range", () => {
    const report = generateWeeklyReport(insights, labels);
    expect(report).toContain("2024-01-01 — 2024-01-02");
    expect(report).toContain("提交数：2");
    expect(report).toContain("本地分支 2，远程分支 3");
    expect(report).not.toContain("最近一周");
    expect(generateProjectIntroduction(insights, labels)).toContain("统计区间：2024-01-01 — 2024-01-02");
  });
  it("falls back to legacy total branch count", () => {
    const legacy = { ...insights, local_branch_count: undefined, remote_branch_count: undefined };
    expect(branchCounts(legacy)).toEqual({ total: 5, local: 5, remote: 0 });
  });
  it("formats one-sided and empty ranges", () => {
    expect(insightPeriod({ ...insights, end_date: null })).toBe("2024-01-01");
    expect(insightPeriod({ ...insights, start_date: null, end_date: null })).toBe("—");
  });
  it("sanitizes export names", () => expect(sanitizeFileName("a:b?.txt")).toBe("a-b-.txt"));
});
