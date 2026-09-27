import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewReport } from "@/types";
import "@/i18n";

const { publishInlineComment, confirmDialog, showMessage, toastSuccess, toastInfo, reviewState, aiState } =
  vi.hoisted(() => ({
    publishInlineComment: vi.fn(),
    confirmDialog: vi.fn(),
    showMessage: vi.fn(),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
    reviewState: { report: null as ReviewReport | null },
    aiState: { loading: false },
  }));

const report: ReviewReport = {
  id: "report-1",
  schema_version: 1,
  summary: "PR review summary",
  findings: [
    {
      id: "finding-1",
      severity: "high",
      category: "security",
      file: "src/main.ts",
      line: 12,
      title: "Validate input",
      description: "Untrusted input reaches this branch.",
      suggestion: "Validate the value before use.",
      confidence: 0.92,
      metadata: {},
      status: "open",
    },
    {
      id: "finding-2",
      severity: "low",
      category: "style",
      file: "src/util.ts",
      line: null,
      title: "Naming nit",
      description: "Ambiguous name.",
      suggestion: "Rename the helper.",
      confidence: 0.6,
      metadata: {},
      status: "open",
    },
  ],
  raw_markdown: null,
  fallback: false,
  generated_at: "2026-09-27T00:00:00Z",
  head_hash: "abc1234def",
  diff_hash: "diff123",
  staged_only: false,
  file_path: null,
  pull_number: 42,
  stale: false,
};

vi.mock("@/stores/aiStore", () => ({
  useAiStore: (selector: (state: unknown) => unknown) =>
    selector({
      prReviewByRepo: { "D:/repo": reviewState.report },
      activeRequestByScope: aiState.loading ? { "D:/repo\u0000pr-review": "request-1" } : {},
      reviewPullRequest: vi.fn(),
      updatePrFindingStatus: vi.fn(),
    }),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: () => ({ success: toastSuccess, error: vi.fn(), info: toastInfo }),
}));

vi.mock("@/services/github", () => ({
  githubService: { publishInlineComment },
}));

vi.mock("@/utils/dialog", () => ({ confirmDialog, showMessage }));

import { PrReviewCard } from "@/components/git/PrReviewCard";

describe("PrReviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishInlineComment.mockResolvedValue("https://github.com/comment");
    confirmDialog.mockResolvedValue(true);
    aiState.loading = false;
    reviewState.report = { ...report, stale: false };
  });

  it("prompts for a review when no PR report exists", () => {
    reviewState.report = null;
    render(<PrReviewCard repoPath="D:/repo" pullNumber={42} />);

    expect(screen.getByText(/尚无 AI 审查结果|No AI review yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AI 审查|AI Review/ })).toBeEnabled();
  });

  it("renders findings and disables publishing while the report is stale", () => {
    reviewState.report = { ...report, stale: true };
    render(<PrReviewCard repoPath="D:/repo" pullNumber={42} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Validate input")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /发布行内评论|Publish inline/ })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: /发布全部可评论|Publish all commentable/ })).toBeDisabled();
  });

  it("publishes only identifiers per finding with pull_review source", async () => {
    render(<PrReviewCard repoPath="D:/repo" pullNumber={42} />);

    fireEvent.click(screen.getAllByRole("button", { name: /发布行内评论|Publish inline/ })[0]);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(publishInlineComment).toHaveBeenCalledWith("D:/repo", {
        pull_number: 42,
        report_id: "report-1",
        finding_id: "finding-1",
        confirmed: true,
        pull_review: true,
      })
    );
    expect(JSON.stringify(publishInlineComment.mock.calls)).not.toMatch(/commit_id|body/);
  });

  it("publishes all commentable findings sequentially after one confirmation", async () => {
    render(<PrReviewCard repoPath="D:/repo" pullNumber={42} />);

    fireEvent.click(screen.getByRole("button", { name: /发布全部可评论|Publish all commentable/ }));
    // 只有一个带行号的发现可发布（finding-2 无行号被跳过）。
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledWith(
      expect.stringMatching(/发布全部行内评论|Publish all inline comments/),
      expect.stringContaining("1"),
      "warning"
    ));
    await waitFor(() => expect(publishInlineComment).toHaveBeenCalledTimes(1));
    expect((publishInlineComment.mock.calls[0] as unknown[])[1]).toMatchObject({ finding_id: "finding-1" });
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("keeps publish buttons disabled for findings without a line number", () => {
    render(<PrReviewCard repoPath="D:/repo" pullNumber={42} />);

    const buttons = screen.getAllByRole("button", { name: /发布行内评论|Publish inline/ });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
  });
});
