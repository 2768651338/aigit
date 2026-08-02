import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewReport } from "@/types";
import "@/i18n";

const { loadReview, updateFindingStatus, selectFile, navigate, publishInlineComment, confirmDialog, reviewState } = vi.hoisted(() => ({
  loadReview: vi.fn(),
  updateFindingStatus: vi.fn(),
  selectFile: vi.fn(),
  navigate: vi.fn(),
  publishInlineComment: vi.fn(),
  confirmDialog: vi.fn(),
  reviewState: { stale: true },
}));

const report: ReviewReport = {
  id: "report-1",
  schema_version: 1,
  summary: "Structured summary",
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
  ],
  raw_markdown: null,
  fallback: false,
  generated_at: "2026-08-01T00:00:00Z",
  head_hash: "abc123",
  diff_hash: "diff123",
  staged_only: true,
  file_path: null,
  stale: true,
};

vi.mock("@/stores/repoStore", () => ({
  useRepoStore: (selector: (state: unknown) => unknown) => selector({
    currentPath: "D:/repo",
    fileStatuses: [{ path: "src/main.ts", old_path: null, status: "modified", staged: true }],
    selectFile,
  }),
}));

vi.mock("@/services/github", () => ({
  githubService: { publishInlineComment },
}));

vi.mock("@/utils/dialog", () => ({ confirmDialog }));

vi.mock("@/stores/aiStore", () => ({
  useAiStore: (selector: (state: unknown) => unknown) => selector({
    reviewCode: vi.fn(),
    loadReview,
    updateFindingStatus,
    loading: false,
    reviewByRepo: { "D:/repo": { ...report, stale: reviewState.stale } },
  }),
  useSettingsStore: () => ({ config: { ai: { active_provider: "openai" } } }),
}));

import { ReviewView } from "@/pages/ReviewView";

describe("structured review interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectFile.mockResolvedValue(undefined);
    publishInlineComment.mockResolvedValue("https://github.com/comment");
    confirmDialog.mockResolvedValue(true);
    reviewState.stale = true;
    vi.spyOn(window, "prompt").mockReturnValue("17");
  });

  it("loads the repository report, surfaces staleness, and updates finding status", async () => {
    render(<ReviewView onNavigateChanges={navigate} />);

    await waitFor(() => expect(loadReview).toHaveBeenCalledWith("D:/repo"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Validate input")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /标记误报|Mark false positive/ }));
    expect(updateFindingStatus).toHaveBeenCalledWith("D:/repo", "finding-1", "false_positive");
  });

  it("publishes only report and finding identifiers after per-item confirmation", async () => {
    reviewState.stale = false;
    render(<ReviewView onNavigateChanges={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: /发布行内评论|Publish inline/ }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(publishInlineComment).toHaveBeenCalledWith("D:/repo", {
      pull_number: 17,
      report_id: "report-1",
      finding_id: "finding-1",
      confirmed: true,
    }));
    expect(JSON.stringify(publishInlineComment.mock.calls)).not.toMatch(/commit_id|path|line|body/);
  });

  it("opens the target file in changes view", async () => {
    render(<ReviewView onNavigateChanges={navigate} />);

    fireEvent.click(screen.getByRole("button", { name: ":12" }));
    await waitFor(() => expect(selectFile).toHaveBeenCalledWith("src/main.ts"));
    expect(navigate).toHaveBeenCalled();
  });
});
