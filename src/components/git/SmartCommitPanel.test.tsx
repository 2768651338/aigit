import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommitPlan } from "@/types";

const { generatePlan, validatePlan, stageGroup, commitGroup, refreshStatus, refreshLog } = vi.hoisted(() => ({
  generatePlan: vi.fn(),
  validatePlan: vi.fn(),
  stageGroup: vi.fn(),
  commitGroup: vi.fn(),
  refreshStatus: vi.fn(),
  refreshLog: vi.fn(),
}));

vi.mock("@/services/ai", () => ({ aiService: { generateSmartCommitPlan: generatePlan } }));
vi.mock("@/services/git", () => ({ gitService: {
  validateSmartCommitPlan: validatePlan,
  stageSmartCommitGroup: stageGroup,
  commitSmartCommitGroup: commitGroup,
} }));
vi.mock("@/stores/repoStore", () => ({ useRepoStore: (selector: (s: unknown) => unknown) => selector({ currentPath: "D:/repo", refreshStatus, refreshLog }) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("@/stores/toastStore", () => ({ useToastStore: () => toast }));

import { SmartCommitPanel } from "@/components/git/SmartCommitPanel";

const plan: CommitPlan = {
  id: "plan", schema_version: 1, existing_staged: false, fallback: false, warning: null,
  snapshot: { repo_path: "D:/repo", head: "123456789", index_tree: "abcdefghi", diff_hash: "diffhash" },
  groups: [{
    id: "group", reason: "one concern", message: "fix(core): correct value", committed_hash: null,
    selections: [{ id: "hunk", file_path: "src/a.ts", old_path: null, hunk_header: "@@ -1 +1 @@", patch: "diff --git a/src/a.ts b/src/a.ts\n", kind: "hunk", fallback_reason: null, snapshot: { repo_path: "D:/repo", head: "123456789", index_tree: "abcdefghi", diff_hash: "diffhash" } }],
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  generatePlan.mockResolvedValue(plan);
  validatePlan.mockResolvedValue(undefined);
  stageGroup.mockResolvedValue({ group_id: "group", staged_tree: "tree", state: "awaiting_commit_confirmation", recovery: "paused" });
  commitGroup.mockResolvedValue({ group_id: "group", commit_hash: "commit", state: "paused_after_commit", recovery: "paused after commit", plan: { ...plan, groups: [{ ...plan.groups[0], committed_hash: "commit" }] } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("SmartCommitPanel", () => {
  it("requires separate stage and commit confirmations and never chains groups", async () => {
    render(<SmartCommitPanel onClose={vi.fn()} />);
    await screen.findByText("fix(core): correct value");
    fireEvent.click(screen.getByRole("button", { name: "smartCommit.stageGroup" }));
    await waitFor(() => expect(stageGroup).toHaveBeenCalledTimes(1));
    expect(commitGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "smartCommit.confirmCommit" }));
    await waitFor(() => expect(commitGroup).toHaveBeenCalledTimes(1));
    expect(stageGroup).toHaveBeenCalledTimes(1);
  });

  it("invalidates the plan without staging when snapshot validation fails", async () => {
    validatePlan.mockRejectedValue(new Error("stale"));
    render(<SmartCommitPanel onClose={vi.fn()} />);
    await screen.findByText("fix(core): correct value");
    fireEvent.click(screen.getByRole("button", { name: "smartCommit.stageGroup" }));
    await waitFor(() => expect(screen.getByText(/stale/)).toBeInTheDocument());
    expect(stageGroup).not.toHaveBeenCalled();
  });
});
