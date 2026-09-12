import { beforeEach, describe, expect, it, vi } from "vitest";

const { git, config, dialog } = vi.hoisted(() => ({
  git: {
    getRepoInfo: vi.fn(),
    getStatus: vi.fn(),
    listBranches: vi.fn(),
    getLog: vi.fn(),
    getOperationState: vi.fn(),
    listRemotes: vi.fn(),
    getTrackingInfo: vi.fn(),
    push: vi.fn(),
    switchBranch: vi.fn(),
  },
  config: {
    addRecentRepo: vi.fn(),
    setOpenRepos: vi.fn(),
  },
  dialog: {
    confirmDialog: vi.fn(),
  },
}));

vi.mock("@/services/git", () => ({ gitService: git }));
vi.mock("@/services/config", () => ({ configService: config }));
vi.mock("@/utils/dialog", () => ({ confirmDialog: dialog.confirmDialog }));

import { useRepoStore } from "@/stores/repoStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const repoInfo = (name: string) => ({
  name,
  path: `/${name}`,
  current_branch: "main",
  is_bare: false,
  head_hash: `${name}-head`,
  has_remote: false,
  remote_url: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useRepoStore.setState({
    tabs: {},
    activePath: null,
    tabOrder: [],
    currentPath: null,
    repoInfo: null,
    fileStatuses: [],
    selectedFile: null,
    workdirDiff: [],
    stagedDiff: [],
    branches: [],
    log: [],
    remotes: [],
    tracking: null,
    fetchUpdatedAt: null,
    remoteBusy: null,
    remoteError: null,
    remoteTask: null,
    loading: false,
    error: null,
    pushing: false,
    pulling: false,
    committing: false,
    commitAndPushing: false,
    refreshing: false,
    pushError: null,
    aiError: null,
    aiLoading: false,
    commitMessage: "",
    stashes: null,
    tags: null,
    submodules: null,
    operationKind: null,
    mergeInProgress: false,
    isRebasing: false,
    conflicts: [],
    merging: false,
  });
  config.addRecentRepo.mockResolvedValue(undefined);
  config.setOpenRepos.mockResolvedValue(undefined);
  dialog.confirmDialog.mockResolvedValue(true);
  git.getStatus.mockImplementation(async (path: string) => [{ path: `${path}.txt`, status: "modified", staged: false }]);
  git.listBranches.mockImplementation(async (path: string) => [{ name: `${path}-branch`, is_head: true, is_remote: false }]);
  git.getLog.mockImplementation(async (path: string) => [{ hash: `${path}-hash`, short_hash: "abc", message: path, body: "", author: "test", author_email: "test@example.com", timestamp: 1, parents: [] }]);
  git.getOperationState.mockResolvedValue({ kind: null, in_progress: false, conflicts: [] });
  git.listRemotes.mockResolvedValue([{ name: "origin", fetch_url: "https://example.com/repo.git", push_url: "https://example.com/repo.git" }]);
  git.getTrackingInfo.mockResolvedValue({ branch: "main", upstream: "origin/main", remote: "origin", remote_branch: "main", ahead: 0, behind: 0 });
});

describe("repoStore cross-tab async isolation", () => {
  it("updates fetch metadata and ahead/behind only for the requested repository", async () => {
    git.getRepoInfo.mockResolvedValue(repoInfo("a"));
    await useRepoStore.getState().openRepo("/a");

    await useRepoStore.getState().loadRemoteState("/a");
    expect(useRepoStore.getState().tabs["/a"].fetchUpdatedAt).toBeNull();

    git.getTrackingInfo.mockResolvedValue({ branch: "main", upstream: "origin/main", remote: "origin", remote_branch: "main", ahead: 3, behind: 2 });
    git.getRepoInfo.mockResolvedValue({ ...repoInfo("a"), ahead: 3, behind: 2 });
    git.listBranches.mockResolvedValue([{ name: "origin/main", is_head: false, is_remote: true }]);
    await useRepoStore.getState().loadRemoteState("/a", true);

    const tab = useRepoStore.getState().tabs["/a"];
    expect(tab.fetchUpdatedAt).toEqual(expect.any(Number));
    expect(tab.tracking?.ahead).toBe(3);
    expect(tab.tracking?.behind).toBe(2);
    expect(tab.repoInfo?.ahead).toBe(3);
    expect(tab.repoInfo?.behind).toBe(2);
    expect(tab.branches[0]?.name).toBe("origin/main");
  });

  it("keeps late open results on their originating tabs", async () => {
    const a = deferred<ReturnType<typeof repoInfo>>();
    const b = deferred<ReturnType<typeof repoInfo>>();
    git.getRepoInfo.mockImplementation((path: string) => path === "/a" ? a.promise : b.promise);

    const openingA = useRepoStore.getState().openRepo("/a");
    const openingB = useRepoStore.getState().openRepo("/b");
    b.resolve(repoInfo("b"));
    await openingB;
    a.resolve(repoInfo("a"));
    await openingA;

    const state = useRepoStore.getState();
    expect(state.activePath).toBe("/b");
    expect(state.currentPath).toBe("/b");
    expect(state.repoInfo?.name).toBe("b");
    expect(state.tabs["/a"].repoInfo?.name).toBe("a");
    expect(state.tabs["/a"].fileStatuses[0]?.path).toBe("/a.txt");
    expect(state.tabs["/b"].fileStatuses[0]?.path).toBe("/b.txt");
    expect(git.getStatus).toHaveBeenCalledWith("/a");
    expect(git.getStatus).toHaveBeenCalledWith("/b");
  });

  it("drops late results after the originating tab is closed", async () => {
    const pending = deferred<ReturnType<typeof repoInfo>>();
    git.getRepoInfo.mockReturnValue(pending.promise);

    const opening = useRepoStore.getState().openRepo("/closed");
    await useRepoStore.getState().closeRepoTab("/closed");
    pending.resolve(repoInfo("closed"));
    await opening;

    expect(useRepoStore.getState().tabs["/closed"]).toBeUndefined();
    expect(git.getStatus).not.toHaveBeenCalledWith("/closed");
  });

  it("pushes the explicitly requested repo while another repo is active", async () => {
    git.getRepoInfo.mockResolvedValue(repoInfo("a"));
    await useRepoStore.getState().openRepo("/a");
    await useRepoStore.getState().openRepo("/b"); // active is now /b

    const pushPending = deferred<string>();
    git.push.mockReturnValue(pushPending.promise);
    const pushing = useRepoStore.getState().push("/a");

    // The busy flag lands on /a's own tab; the active tab (/b) stays clean.
    expect(git.push).toHaveBeenCalledWith("/a", undefined, undefined);
    expect(useRepoStore.getState().tabs["/a"].pushing).toBe(true);
    expect(useRepoStore.getState().pushing).toBe(false);

    pushPending.resolve("ok");
    await pushing;

    expect(useRepoStore.getState().tabs["/a"].pushing).toBe(false);
    expect(useRepoStore.getState().pushing).toBe(false);
  });

  it("keeps commit&push busy flags on their originating repo across a tab switch", async () => {
    git.getRepoInfo.mockResolvedValue(repoInfo("a"));
    await useRepoStore.getState().openRepo("/a");

    useRepoStore.getState().setCommitAndPushingFor("/a", true);
    expect(useRepoStore.getState().commitAndPushing).toBe(true);

    // User switches to /b while the commit&push is in flight.
    await useRepoStore.getState().openRepo("/b");
    expect(useRepoStore.getState().commitAndPushing).toBe(false);

    // Completion arrives while /b is active: clearing must land on /a…
    useRepoStore.getState().setCommitAndPushingFor("/a", false);
    useRepoStore.getState().setPushErrorFor("/a", "boom");

    // …and switching back shows /a unbusy with its own error, /b untouched.
    useRepoStore.getState().setActiveRepo("/a");
    expect(useRepoStore.getState().commitAndPushing).toBe(false);
    expect(useRepoStore.getState().pushError).toBe("boom");
    expect(useRepoStore.getState().tabs["/b"].commitAndPushing).toBe(false);
    expect(useRepoStore.getState().tabs["/b"].pushError).toBeNull();
  });
});

describe("repoStore moveRepoTab", () => {
  function seed(tabOrder: string[], activePath: string | null) {
    useRepoStore.setState({ tabOrder, activePath });
  }

  it("moves a repo before the target and persists the new order", () => {
    seed(["/a", "/b", "/c"], "/a");
    useRepoStore.getState().moveRepoTab("/c", "/a", "before");
    expect(useRepoStore.getState().tabOrder).toEqual(["/c", "/a", "/b"]);
    expect(config.setOpenRepos).toHaveBeenCalledWith(["/c", "/a", "/b"], "/a");
  });

  it("moves a repo after the target (lower half drop)", () => {
    seed(["/a", "/b", "/c"], "/c");
    useRepoStore.getState().moveRepoTab("/a", "/b", "after");
    expect(useRepoStore.getState().tabOrder).toEqual(["/b", "/a", "/c"]);
    expect(config.setOpenRepos).toHaveBeenCalledWith(["/b", "/a", "/c"], "/c");
  });

  it("keeps the active tab active after reordering", () => {
    seed(["/a", "/b"], "/b");
    useRepoStore.getState().moveRepoTab("/b", "/a", "before");
    expect(useRepoStore.getState().activePath).toBe("/b");
  });

  it("ignores dropping a repo onto itself", () => {
    seed(["/a", "/b"], "/a");
    useRepoStore.getState().moveRepoTab("/a", "/a", "before");
    expect(useRepoStore.getState().tabOrder).toEqual(["/a", "/b"]);
    expect(config.setOpenRepos).not.toHaveBeenCalled();
  });

  it("ignores a drop that restores the original position", () => {
    seed(["/a", "/b", "/c"], "/a");
    useRepoStore.getState().moveRepoTab("/a", "/b", "before");
    useRepoStore.getState().moveRepoTab("/b", "/a", "after");
    expect(useRepoStore.getState().tabOrder).toEqual(["/a", "/b", "/c"]);
    expect(config.setOpenRepos).not.toHaveBeenCalled();
  });

  it("ignores unknown repo paths", () => {
    seed(["/a", "/b"], "/a");
    useRepoStore.getState().moveRepoTab("/missing", "/a", "before");
    useRepoStore.getState().moveRepoTab("/a", "/missing", "after");
    expect(useRepoStore.getState().tabOrder).toEqual(["/a", "/b"]);
    expect(config.setOpenRepos).not.toHaveBeenCalled();
  });
});

describe("repoStore switchBranch dirty-worktree guard", () => {
  const uncommittedError = {
    code: "uncommitted_changes",
    message: "Uncommitted changes: switching to 'feature' would discard them",
    retryable: false,
  };

  beforeEach(() => {
    git.getRepoInfo.mockResolvedValue(repoInfo("a"));
  });

  it("asks for confirmation and force-switches after the user confirms", async () => {
    await useRepoStore.getState().openRepo("/a");
    git.switchBranch
      .mockRejectedValueOnce(uncommittedError)
      .mockResolvedValueOnce(undefined);

    const result = await useRepoStore.getState().switchBranch("feature");

    expect(result).toBe(true);
    expect(dialog.confirmDialog).toHaveBeenCalledTimes(1);
    expect(dialog.confirmDialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("feature")
    );
    expect(git.switchBranch).toHaveBeenNthCalledWith(1, "/a", "feature", false);
    expect(git.switchBranch).toHaveBeenNthCalledWith(2, "/a", "feature", true);
  });

  it("does not retry when the user declines the confirmation", async () => {
    await useRepoStore.getState().openRepo("/a");
    git.switchBranch.mockRejectedValueOnce(uncommittedError);
    dialog.confirmDialog.mockResolvedValueOnce(false);

    const result = await useRepoStore.getState().switchBranch("feature");

    expect(result).toBe(false);
    expect(git.switchBranch).toHaveBeenCalledTimes(1);
    // A declined switch is not an error — no banner is shown.
    expect(useRepoStore.getState().tabs["/a"].error).toBeNull();
  });

  it("does not ask for confirmation when force was requested upfront", async () => {
    await useRepoStore.getState().openRepo("/a");
    git.switchBranch.mockRejectedValueOnce(uncommittedError);

    const result = await useRepoStore.getState().switchBranch("feature", true);

    expect(result).toBe(false);
    expect(dialog.confirmDialog).not.toHaveBeenCalled();
    expect(git.switchBranch).toHaveBeenCalledTimes(1);
  });

  it("routes unrelated switch errors to the tab error banner", async () => {
    await useRepoStore.getState().openRepo("/a");
    git.switchBranch.mockRejectedValueOnce({
      code: "git_error",
      message: "boom",
      retryable: false,
    });

    const result = await useRepoStore.getState().switchBranch("feature");

    expect(result).toBe(false);
    expect(dialog.confirmDialog).not.toHaveBeenCalled();
    expect(useRepoStore.getState().tabs["/a"].error).toContain("boom");
  });
});
