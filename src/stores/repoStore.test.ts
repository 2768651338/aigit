import { beforeEach, describe, expect, it, vi } from "vitest";

const { git, config } = vi.hoisted(() => ({
  git: {
    getRepoInfo: vi.fn(),
    getStatus: vi.fn(),
    listBranches: vi.fn(),
    getLog: vi.fn(),
    getOperationState: vi.fn(),
    listRemotes: vi.fn(),
    getTrackingInfo: vi.fn(),
  },
  config: {
    addRecentRepo: vi.fn(),
    setOpenRepos: vi.fn(),
  },
}));

vi.mock("@/services/git", () => ({ gitService: git }));
vi.mock("@/services/config", () => ({ configService: config }));

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
  git.getStatus.mockImplementation(async (path: string) => [{ path: `${path}.txt`, status: "modified", staged: false }]);
  git.listBranches.mockImplementation(async (path: string) => [{ name: `${path}-branch`, is_head: true, is_remote: false }]);
  git.getLog.mockImplementation(async (path: string) => [{ hash: `${path}-hash`, short_hash: "abc", message: path, author: "test", author_email: "test@example.com", timestamp: 1, parents: [] }]);
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
