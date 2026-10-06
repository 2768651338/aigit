import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardView } from "@/pages/DashboardView";

const services = vi.hoisted(() => ({
  getReposDashboard: vi.fn(),
  fetchTask: vi.fn(),
  cancelGitTask: vi.fn(),
}));

const repoStoreState = vi.hoisted(() => ({
  tabOrder: [] as string[],
  activePath: null as string | null,
  openRepo: vi.fn(),
}));

vi.mock("@/services/git", () => ({ gitService: services }));
vi.mock("@/stores/repoStore", () => ({
  useRepoStore: Object.assign(
    (selector: (s: typeof repoStoreState) => unknown) => selector(repoStoreState),
    { getState: () => repoStoreState },
  ),
}));
vi.mock("@/stores/aiStore", () => ({
  useSettingsStore: (selector: (s: { config: unknown }) => unknown) =>
    selector({ config: { recent_repos: [] } }),
}));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const baseItem = {
  path: "",
  valid: true,
  name: "",
  current_branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged_files: 0,
  unstaged_files: 0,
  untracked_files: 0,
  head_summary: null,
  last_commit_ts: null,
  unborn: false,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  repoStoreState.tabOrder = [];
  repoStoreState.activePath = null;
});

describe("DashboardView", () => {
  it("renders repo rows with branch, ahead/behind and dirty counts, and opens repo on click", async () => {
    repoStoreState.tabOrder = ["D:/repos/demo"];
    services.getReposDashboard.mockResolvedValue([
      {
        ...baseItem,
        path: "D:/repos/demo",
        name: "demo",
        current_branch: "main",
        upstream: "origin/main",
        ahead: 2,
        behind: 1,
        staged_files: 1,
        unstaged_files: 2,
        untracked_files: 3,
        head_summary: "feat: demo",
        last_commit_ts: Math.floor(Date.now() / 1000) - 3600,
      },
    ]);

    render(<DashboardView />);

    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("↑2")).toBeInTheDocument();
    expect(screen.getByText("↓1")).toBeInTheDocument();
    // 未提交总数 = 1 + 2 + 3
    expect(screen.getByText(/6 dashboard.dirty/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("demo"));
    expect(repoStoreState.openRepo).toHaveBeenCalledWith("D:/repos/demo");
  });

  it("marks invalid repos and does not open them on click", async () => {
    repoStoreState.tabOrder = ["D:/repos/gone"];
    services.getReposDashboard.mockResolvedValue([
      { ...baseItem, path: "D:/repos/gone", name: "gone", valid: false, error: "not a repository" },
    ]);

    render(<DashboardView />);

    expect(await screen.findByText("dashboard.invalid")).toBeInTheDocument();
    expect(screen.getByText("not a repository")).toBeInTheDocument();

    fireEvent.click(screen.getByText("gone"));
    expect(repoStoreState.openRepo).not.toHaveBeenCalled();
  });

  it("shows the empty state when no repos are known", async () => {
    services.getReposDashboard.mockResolvedValue([]);

    render(<DashboardView />);

    expect(await screen.findByText("dashboard.empty")).toBeInTheDocument();
  });

  it("fetch-all runs per repo with cancellable tasks and reports the summary", async () => {
    repoStoreState.tabOrder = ["D:/repos/a", "D:/repos/b"];
    services.getReposDashboard
      .mockResolvedValueOnce([
        { ...baseItem, path: "D:/repos/a", name: "a", current_branch: "main" },
        { ...baseItem, path: "D:/repos/b", name: "b", current_branch: "dev" },
      ])
      .mockResolvedValue([
        { ...baseItem, path: "D:/repos/a", name: "a", current_branch: "main" },
        { ...baseItem, path: "D:/repos/b", name: "b", current_branch: "dev" },
      ]);
    services.fetchTask.mockResolvedValue("done");

    render(<DashboardView />);
    const button = await screen.findByRole("button", { name: "dashboard.fetchAll" });
    fireEvent.click(button);

    // 两个仓库各一次可取消 fetch。
    await vi.waitFor(() => {
      expect(services.fetchTask).toHaveBeenCalledTimes(2);
    });
    expect(services.fetchTask.mock.calls[0][0]).toBe("D:/repos/a");
    expect(services.fetchTask.mock.calls[0][1]).toMatch(/^dashboard:fetch:/);
    expect(services.fetchTask.mock.calls[1][0]).toBe("D:/repos/b");
  });
});
