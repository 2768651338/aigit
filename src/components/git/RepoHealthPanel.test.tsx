import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoHealthPanel } from "./RepoHealthPanel";

const services = vi.hoisted(() => ({
  getRepoHealth: vi.fn(),
  deleteBranch: vi.fn(),
}));

const ai = vi.hoisted(() => ({
  repoChat: vi.fn(),
}));

const configService = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

const translate = vi.hoisted(() => (key: string) => key);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

const store = vi.hoisted(() => ({
  currentPath: "C:/repo",
  deleteBranch: vi.fn(() => Promise.resolve()),
  refreshBranches: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-i18next", () => ({
  // `initReactI18next` must exist because modules in this graph (error.ts)
  // initialize the real i18n singleton.
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: translate, i18n: { language: "en" } }),
}));
vi.mock("@/services/git", () => ({ gitService: services }));
vi.mock("@/services/ai", () => ({ aiService: ai }));
vi.mock("@/services/config", () => ({ configService: configService }));
vi.mock("@/stores/toastStore", () => ({ useToastStore: () => toast }));
vi.mock("@/utils/dialog", () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/stores/repoStore", () => ({
  useRepoStore: Object.assign(() => store, { getState: () => store }),
}));

const now = Math.floor(Date.now() / 1000);
const day = 86_400;

function healthReport() {
  return {
    default_branch: "main",
    stale_branches: [
      { name: "old-1", last_commit_date: now - 40 * day, last_commit_message: "old commit", occupied_by_worktree: false },
      { name: "wt-held", last_commit_date: now - 35 * day, last_commit_message: "", occupied_by_worktree: true },
    ],
    merged_local_branches: [
      { name: "old-1", last_commit_date: now - 40 * day, last_commit_message: "old commit", occupied_by_worktree: false },
      { name: "other", last_commit_date: now - 32 * day, last_commit_message: "", occupied_by_worktree: false },
      { name: "wt-held", last_commit_date: now - 35 * day, last_commit_message: "", occupied_by_worktree: true },
    ],
    unmerged_remote_branches: [
      { name: "origin/feature", last_commit_date: now - day, last_commit_message: "wip", occupied_by_worktree: false },
    ],
    large_files: [{ path: "assets/big.bin", size_bytes: 6 * 1024 * 1024 }],
    stash: { count: 2, oldest_date: now - 90 * day },
    truncated: { branches: false, files: false },
  };
}

describe("RepoHealthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.getRepoHealth.mockResolvedValue(healthReport());
    services.deleteBranch.mockResolvedValue(undefined);
    ai.repoChat.mockResolvedValue("clean up old-1 first");
    configService.getConfig.mockResolvedValue({
      health: { stale_days: 30, large_file_min_mb: 5, large_file_top_n: 20, max_scan_entries: 50000 },
    });
  });

  it("loads the report with thresholds from settings and renders all sections", async () => {
    render(<RepoHealthPanel onOpenStash={() => {}} />);

    await waitFor(() =>
      expect(services.getRepoHealth).toHaveBeenCalledWith("C:/repo", {
        staleDays: 30,
        largeFileMinMb: 5,
        largeFileTopN: 20,
      }),
    );
    expect(await screen.findAllByText("old-1").then((els) => els.length)).toBeGreaterThan(0);
    expect((await screen.findAllByText("wt-held")).length).toBeGreaterThan(0);
    // The worktree-occupied branch is marked and gets no delete affordance.
    expect((await screen.findAllByText("health.worktreeOccupied")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("health.deleteBranch wt-held")).not.toBeInTheDocument();
    expect(screen.getByText("origin/feature")).toBeInTheDocument();
    expect(screen.getByText("assets/big.bin")).toBeInTheDocument();
    expect(screen.getByText("health.stashBacklogSummary")).toBeInTheDocument();
    expect(screen.queryByText("health.noStaleBranches")).not.toBeInTheDocument();
  });

  it("deletes a single branch after confirmation and refreshes", async () => {
    render(<RepoHealthPanel />);
    // The same branch may appear in several sections; click any of its rows.
    fireEvent.click((await screen.findAllByLabelText("health.deleteBranch old-1"))[0]);

    // Deletion goes through the repo store action (which refreshes branches).
    await waitFor(() => expect(store.deleteBranch).toHaveBeenCalledWith("old-1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("health.branchDeleted"));
    expect(services.getRepoHealth).toHaveBeenCalledTimes(2);
  });

  it("batch-deletes only unoccupied merged branches and reports the summary", async () => {
    render(<RepoHealthPanel />);
    fireEvent.click(await screen.findByText("health.deleteAllMerged"));

    await waitFor(() => expect(services.deleteBranch).toHaveBeenCalledTimes(2));
    expect(services.deleteBranch).toHaveBeenCalledWith("C:/repo", "old-1");
    expect(services.deleteBranch).toHaveBeenCalledWith("C:/repo", "other");
    expect(services.deleteBranch).not.toHaveBeenCalledWith("C:/repo", "wt-held");
    expect(toast.success).toHaveBeenCalledWith("health.batchDeleteDone");
  });

  it("skips deletion entirely when the user cancels the confirm dialog", async () => {
    const { confirmDialog } = await import("@/utils/dialog");
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    render(<RepoHealthPanel />);
    fireEvent.click(await screen.findByText("health.deleteAllMerged"));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(services.deleteBranch).not.toHaveBeenCalled();
  });

  it("generates a one-shot AI suggestion over a redacted untrusted payload", async () => {
    render(<RepoHealthPanel />);
    fireEvent.click(await screen.findByText("health.aiGenerate"));

    await waitFor(() => expect(ai.repoChat).toHaveBeenCalledTimes(1));
    const [messages, repoPath] = ai.repoChat.mock.calls[0];
    expect(repoPath).toBe("C:/repo");
    const content = messages[0].content as string;
    expect(content).toContain("health.aiPrompt");
    expect(content).toContain("<untrusted>");
    // Commit messages are deliberately not part of the payload.
    expect(content).not.toContain("old commit");
    expect(await screen.findByText("clean up old-1 first")).toBeInTheDocument();
    expect(screen.getByText("health.copySuggestion")).toBeInTheDocument();
  });

  it("surfaces truncation warnings from the report", async () => {
    services.getRepoHealth.mockResolvedValue({
      ...healthReport(),
      truncated: { branches: true, files: true },
    });
    render(<RepoHealthPanel />);

    expect(await screen.findByText("health.truncatedBranches")).toBeInTheDocument();
    expect(screen.getByText("health.truncatedFiles")).toBeInTheDocument();
  });
});
