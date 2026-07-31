import { describe, expect, it } from "vitest";
import { applyAuthorAliases, contributionIntensity, createTimelineFrames, fillDateRange, generateProjectIntroduction, generateWeeklyReport, sanitizeFileName } from "./insights";
import type { ContributorInsights, RepositoryInsights } from "@/types";

const contributor = (name: string, email: string, count: number): ContributorInsights => ({ name, email, commit_count: count, active_days: 1, first_date: "2024-01-01", last_date: "2024-01-01", activity: [count] });
const insights: RepositoryInsights = { repository_name: "demo", start_date: "2024-01-01", end_date: "2024-01-02", total_commits: 2, contributor_count: 1, branch_count: 2, tag_count: 1, daily_contributions: [], contributors: [contributor("A", "a@example.com", 2)], timeline: [], milestones: [], recent_commits: [{ hash: "abc", author: "A", date: "2024-01-01", message: "initial" }] };

describe("insights utilities", () => {
  it("fills missing dates with zero", () => expect(fillDateRange([{ date: "2024-01-02", count: 2 }], "2024-01-01", "2024-01-03")).toEqual([{ date: "2024-01-01", count: 0 }, { date: "2024-01-02", count: 2 }, { date: "2024-01-03", count: 0 }]));
  it("groups aliases case-insensitively", () => expect(applyAuthorAliases([contributor("A", "A@EXAMPLE.COM", 2), contributor("B", "b@example.com", 3)], [{ email: "a@example.com", display_name: "Team" }, { email: "b@example.com", display_name: "Team" }])[0].commit_count).toBe(5));
  it("assigns intensity and caps timeline frames", () => { expect(contributionIntensity(0, 5)).toBe(0); expect(contributionIntensity(5, 5)).toBe(4); expect(createTimelineFrames(Array.from({ length: 10 }, (_, i) => ({ period: String(i), cumulative_commits: i, cumulative_contributors: 1, commits: 1, contributors: 1 })), 3)).toHaveLength(3); });
  it("generates markdown templates and safe names", () => { expect(generateWeeklyReport(insights)).toContain("# demo 周报"); expect(generateProjectIntroduction(insights)).toContain("2"); expect(sanitizeFileName("a:b?.txt")).toBe("a-b-.txt"); });
});
