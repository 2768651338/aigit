import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemotePanel } from "./RemotePanel";

const services = vi.hoisted(() => ({
  listRemotes: vi.fn(),
  getTrackingInfo: vi.fn(),
  renameRemote: vi.fn(),
  setRemoteUrl: vi.fn(),
  addRemote: vi.fn(),
  removeRemote: vi.fn(),
  fetchTask: vi.fn(),
  pullTask: vi.fn(),
  pushTask: vi.fn(),
  cancelGitTask: vi.fn(),
  setUpstream: vi.fn(),
  createTrackingBranch: vi.fn(),
}));

const translate = vi.hoisted(() => (key: string) => key);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

const store = vi.hoisted(() => ({
  currentPath: "C:/repo",
  branches: [{ name: "origin/main", is_remote: true }],
  remotes: [{ name: "origin", fetch_url: "fetch-old", push_url: "push-old" }],
  tracking: { branch: "main", upstream: "origin/main", remote: "origin", remote_branch: "main", ahead: 2, behind: 1 },
  fetchUpdatedAt: null as number | null,
  remoteBusy: null as string | null,
  remoteTask: null as { key: "fetch" | "pull" | "push"; id: string } | null,
  loadRemoteState: vi.fn(() => Promise.resolve()),
  setRemoteBusy: vi.fn(),
  setRemoteError: vi.fn(),
  setRemoteTask: vi.fn(),
  refreshBranches: vi.fn(() => Promise.resolve()),
  refreshLog: vi.fn(() => Promise.resolve()),
  refreshRepoInfo: vi.fn(() => Promise.resolve()),
  refreshStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/services/git", () => ({ gitService: services }));
vi.mock("@/stores/toastStore", () => ({ useToastStore: () => toast }));
vi.mock("@/utils/dialog", () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/stores/repoStore", () => ({
  useRepoStore: Object.assign(() => store, { getState: () => ({ tabs: { "C:/repo": store } }) }),
}));

describe("RemotePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.listRemotes.mockResolvedValue([{ name: "origin", fetch_url: "fetch-old", push_url: "push-old" }]);
    services.getTrackingInfo.mockResolvedValue({ branch: "main", upstream: "origin/main", remote: "origin", remote_branch: "main", ahead: 2, behind: 1 });
    services.renameRemote.mockResolvedValue(undefined);
    services.setRemoteUrl.mockResolvedValue(undefined);
  });

  it("edits remote name and fetch/push URLs independently", async () => {
    render(<RemotePanel />);
    fireEvent.click((await screen.findAllByText("origin")).find((element) => element.tagName === "BUTTON")!);
    const nameInput = screen.getByPlaceholderText("remotes.name");
    const fetchInput = screen.getByPlaceholderText("remotes.fetchUrl");
    const pushInput = screen.getByPlaceholderText("remotes.pushUrl");
    fireEvent.change(nameInput, { target: { value: "upstream" } });
    fireEvent.change(fetchInput, { target: { value: "fetch-new" } });
    fireEvent.change(pushInput, { target: { value: "push-new" } });
    fireEvent.click(screen.getAllByRole("button").find((button) => button.className.includes("btn-primary"))!);

    await waitFor(() => expect(services.renameRemote).toHaveBeenCalledWith("C:/repo", "origin", "upstream"));
    expect(services.setRemoteUrl).toHaveBeenNthCalledWith(1, "C:/repo", "upstream", "fetch-new", false);
    expect(services.setRemoteUrl).toHaveBeenNthCalledWith(2, "C:/repo", "upstream", "push-new", true);
  });

  it("creates a local tracking branch from a remote branch", async () => {
    services.createTrackingBranch.mockResolvedValue("topic");
    render(<RemotePanel />);
    const select = await screen.findByDisplayValue("remotes.chooseRemoteBranch");
    fireEvent.change(select, { target: { value: "origin/main" } });
    fireEvent.click(screen.getByText("remotes.create"));
    await waitFor(() => expect(services.createTrackingBranch).toHaveBeenCalledWith("C:/repo", "origin/main", undefined));
  });
});
