import { create } from "zustand";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  GitOperationKind,
  LogEntry,
  MergeResult,
  RemoteInfo,
  RepoInfo,
  RepoTabState,
  StashInfo,
  SubmoduleInfo,
  TagInfo,
  TrackingInfo,
} from "@/types";
import { gitService } from "@/services/git";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";

/**
 * Shape of the active-tab fields mirrored from `tabs[activePath]`.
 * Pages continue to destructure these directly so they don't need to know
 * about the tab map.
 */
interface ActiveTabProjection {
  currentPath: string | null;
  repoInfo: RepoInfo | null;
  fileStatuses: FileStatus[];
  selectedFile: string | null;
  workdirDiff: FileDiff[];
  stagedDiff: FileDiff[];
  branches: BranchInfo[];
  log: LogEntry[];
  remotes: RemoteInfo[];
  tracking: TrackingInfo | null;
  fetchUpdatedAt: number | null;
  remoteBusy: string | null;
  remoteError: string | null;
  remoteTask: RepoTabState["remoteTask"];
  loading: boolean;
  error: string | null;
  pushing: boolean;
  pulling: boolean;
  committing: boolean;
  commitAndPushing: boolean;
  refreshing: boolean;
  pushError: string | null;
  aiError: string | null;
  aiLoading: boolean;
  commitMessage: string;
  stashes: StashInfo[] | null;
  tags: TagInfo[] | null;
  submodules: SubmoduleInfo[] | null;
  operationKind: GitOperationKind | null;
  mergeInProgress: boolean;
  isRebasing: boolean;
  conflicts: string[];
  merging: boolean;
}

interface RepoStoreState extends ActiveTabProjection {
  /** Source of truth: per-repo state keyed by absolute path. */
  tabs: Record<string, RepoTabState>;
  /** Path of the currently active tab. `null` when no tab is open. */
  activePath: string | null;
  /** Ordered list of open tab paths (for the TabBar). */
  tabOrder: string[];

  // Tab-level actions
  /** Open a repo in a new tab (or activate it if already open). */
  openRepo: (path: string) => Promise<void>;
  /** Close a tab. If it was active, activate the previous tab (or null). */
  closeRepoTab: (path: string) => Promise<void>;
  /** Switch the active tab. */
  setActiveRepo: (path: string) => void;

  // Per-tab state setters (operate on the active tab)
  setCommitMessage: (message: string) => void;
  setPushError: (error: string | null) => void;
  setAiError: (error: string | null) => void;
  setAiLoading: (loading: boolean) => void;
  setCommitting: (v: boolean) => void;
  setCommitAndPushing: (v: boolean) => void;
  setPushing: (v: boolean) => void;
  setPulling: (v: boolean) => void;

  // Path-targeted setters (write to an explicit tab instead of the active one).
  // Used by async flows whose `await` may straddle a tab switch (e.g. AI
  // commit-message generation): the result must land on the originating repo,
  // not whichever repo happens to be active when the promise resolves.
  setCommitMessageFor: (path: string, message: string) => void;
  setAiErrorFor: (path: string, error: string | null) => void;
  setAiLoadingFor: (path: string, loading: boolean) => void;

  // Git operations (operate on the active tab)
  refreshStatus: (force?: boolean) => Promise<void>;
  refreshRepoInfo: () => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  stageFiles: (files: string[]) => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  discardFiles: (files: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  amend: (message: string, includeStaged?: boolean, confirmPushed?: boolean) => Promise<string>;
  push: (remote?: string, remoteBranch?: string) => Promise<string>;
  pull: () => Promise<string>;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshLog: (force?: boolean) => Promise<void>;
  loadRemoteState: (path?: string, afterFetch?: boolean) => Promise<void>;
  setRemoteBusy: (path: string, busy: string | null) => void;
  setRemoteError: (path: string, error: string | null) => void;
  setRemoteTask: (path: string, task: RepoTabState["remoteTask"]) => void;
  switchBranch: (name: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  clearError: () => void;

  // Patch-level staging (stage/unstage selected hunks or lines).
  applyPatchToIndex: (patch: string) => Promise<void>;
  applyPatchToIndexReverse: (patch: string) => Promise<void>;

  // Stash
  refreshStashes: () => Promise<void>;
  stashSave: (
    message?: string,
    includeUntracked?: boolean,
    keepIndex?: boolean
  ) => Promise<string>;
  stashApply: (index: number) => Promise<string>;
  stashPop: (index: number) => Promise<string>;
  stashDrop: (index: number) => Promise<string>;

  // Tags
  refreshTags: () => Promise<void>;
  createTag: (name: string, message?: string) => Promise<string>;
  deleteTag: (name: string) => Promise<void>;

  // Submodules
  refreshSubmodules: () => Promise<void>;
  updateSubmodule: (name?: string) => Promise<string>;
  addSubmodule: (
    url: string,
    path: string,
    branch?: string
  ) => Promise<string>;
  removeSubmodule: (name: string) => Promise<string>;

  // Merge / Rebase
  mergeBranch: (branch: string, noFf?: boolean) => Promise<MergeResult>;
  rebaseBranch: (branch: string) => Promise<MergeResult>;
  abortMerge: () => Promise<string>;
  abortRebase: () => Promise<string>;
  continueMerge: () => Promise<string>;
  continueRebase: () => Promise<string>;
  skipRebase: () => Promise<string>;
  refreshMergeState: () => Promise<void>;
  resolveOurs: (files: string[]) => Promise<string>;
  resolveTheirs: (files: string[]) => Promise<string>;

  // History (commit-level operations on a single commit)
  checkoutCommit: (hash: string) => Promise<void>;
  revertCommit: (hash: string) => Promise<MergeResult>;
  cherryPickCommit: (hash: string) => Promise<MergeResult>;
  resetToCommit: (hash: string, mode: string) => Promise<void>;
}

function createEmptyTab(path: string): RepoTabState {
  return {
    path,
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
    commitMessage: "",
    committing: false,
    commitAndPushing: false,
    refreshing: false,
    pushError: null,
    aiError: null,
    aiLoading: false,
    stashes: null,
    tags: null,
    submodules: null,
    operationKind: null,
    mergeInProgress: false,
    isRebasing: false,
    conflicts: [],
    merging: false,
  };
}

/** Read a tab by path, returning a fresh empty tab if missing. */
function getTab(
  tabs: Record<string, RepoTabState>,
  path: string | null,
): RepoTabState | null {
  if (!path) return null;
  return tabs[path] ?? null;
}

/**
 * Shallow-compare two file-status arrays. Used by `refreshStatus` to skip
 * state updates when the 5-second polling returns identical data, which
 * prevents unnecessary re-renders (UI thrash).
 */
function fileStatusesEqual(a: FileStatus[], b: FileStatus[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.path !== y.path ||
      x.status !== y.status ||
      x.staged !== y.staged ||
      x.old_path !== y.old_path
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build the flat projection of the active tab so existing pages keep working
 * unchanged. When `activePath` is null, all fields fall back to defaults.
 */
function projectActiveTab(
  tabs: Record<string, RepoTabState>,
  activePath: string | null,
): ActiveTabProjection {
  const tab = getTab(tabs, activePath);
  if (!tab) {
    return {
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
    };
  }
  return {
    currentPath: activePath,
    repoInfo: tab.repoInfo,
    fileStatuses: tab.fileStatuses,
    selectedFile: tab.selectedFile,
    workdirDiff: tab.workdirDiff,
    stagedDiff: tab.stagedDiff,
    branches: tab.branches,
    log: tab.log,
    remotes: tab.remotes,
    tracking: tab.tracking,
    fetchUpdatedAt: tab.fetchUpdatedAt,
    remoteBusy: tab.remoteBusy,
    remoteError: tab.remoteError,
    remoteTask: tab.remoteTask,
    loading: tab.loading,
    error: tab.error,
    pushing: tab.pushing,
    pulling: tab.pulling,
    committing: tab.committing,
    commitAndPushing: tab.commitAndPushing,
    refreshing: tab.refreshing,
    pushError: tab.pushError,
    aiError: tab.aiError,
    aiLoading: tab.aiLoading,
    commitMessage: tab.commitMessage,
    stashes: tab.stashes,
    tags: tab.tags,
    submodules: tab.submodules,
    operationKind: tab.operationKind,
    mergeInProgress: tab.mergeInProgress,
    isRebasing: tab.isRebasing,
    conflicts: tab.conflicts,
    merging: tab.merging,
  };
}

/**
 * Apply a partial update to a tab and re-project the active tab's flat fields.
 * If `path` matches `activePath`, the flat fields are synced automatically.
 * If `path` is not the active tab, only `tabs` is updated (flat fields stay).
 */
function updateTab(
  set: (partial: Partial<RepoStoreState>) => void,
  get: () => RepoStoreState,
  path: string,
  partial: Partial<RepoTabState>,
): void {
  const { tabs, activePath } = get();
  const current = tabs[path];
  if (!current) return;
  const nextTab: RepoTabState = { ...current, ...partial };
  const nextTabs = { ...tabs, [path]: nextTab };
  const next: Partial<RepoStoreState> = { tabs: nextTabs };
  if (path === activePath) {
    Object.assign(next, projectActiveTab(nextTabs, activePath));
  }
  set(next);
}

/** Persist the current tab set + active tab to config.toml. */
async function persistTabs(
  tabOrder: string[],
  activePath: string | null,
): Promise<void> {
  try {
    await configService.setOpenRepos(tabOrder, activePath);
  } catch (e) {
    // Persistence is best-effort — don't block UI on config write failures.
    console.warn("[repoStore] Failed to persist open tabs:", e);
  }
}

export const useRepoStore = create<RepoStoreState>((set, get) => ({
  tabs: {},
  activePath: null,
  tabOrder: [],
  ...projectActiveTab({}, null),

  openRepo: async (path: string) => {
    const state = get();
    // If the repo is already open in a tab, just activate it.
    if (state.tabs[path]) {
      get().setActiveRepo(path);
      // Refresh in case it's been a while.
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      return;
    }

    // Create a fresh tab and mark it as loading immediately so the UI can
    // show a spinner while we fetch repo info.
    const newTab = createEmptyTab(path);
    newTab.loading = true;
    newTab.error = null;
    const nextTabs = { ...state.tabs, [path]: newTab };
    const nextTabOrder = [...state.tabOrder, path];
    set({
      tabs: nextTabs,
      tabOrder: nextTabOrder,
      activePath: path,
      ...projectActiveTab(nextTabs, path),
    });
    void persistTabs(nextTabOrder, path);

    try {
      const info = await gitService.getRepoInfo(path);
      // Record in recent_repos (best-effort).
      try {
        await configService.addRecentRepo(path);
      } catch (e) {
        console.warn("[repoStore] addRecentRepo failed:", e);
      }
      updateTab(set, get, path, { repoInfo: info, loading: false });

      // Load the originating repository explicitly. The user may switch tabs
      // while getRepoInfo/addRecentRepo is awaiting; calling the active-tab
      // refresh actions here would otherwise write repo A's completion into
      // whichever tab is active at that moment.
      if (!get().tabs[path]) return;
      const [statuses, branches, log, operation] = await Promise.all([
        gitService.getStatus(path),
        gitService.listBranches(path),
        gitService.getLog(path, 100),
        gitService.getOperationState(path),
      ]);
      updateTab(set, get, path, {
        fileStatuses: statuses,
        branches,
        log,
        operationKind: operation.kind,
        mergeInProgress: operation.in_progress,
        isRebasing: operation.kind === "rebase",
        conflicts: operation.conflicts,
      });
    } catch (e) {
      updateTab(set, get, path, {
        loading: false,
        error: formatError(e),
      });
    }
  },

  closeRepoTab: async (path: string) => {
    const { tabs, tabOrder, activePath } = get();
    if (!tabs[path]) return;

    const nextTabs = { ...tabs };
    delete nextTabs[path];
    const nextTabOrder = tabOrder.filter((p) => p !== path);

    let nextActive = activePath;
    if (activePath === path) {
      // Activate the previous tab in the order, or null if none left.
      const closedIdx = tabOrder.indexOf(path);
      nextActive =
        nextTabOrder[Math.min(closedIdx, nextTabOrder.length - 1)] ?? null;
    }

    set({
      tabs: nextTabs,
      tabOrder: nextTabOrder,
      activePath: nextActive,
      ...projectActiveTab(nextTabs, nextActive),
    });
    void persistTabs(nextTabOrder, nextActive);
  },

  setActiveRepo: (path: string) => {
    const { tabs, activePath } = get();
    if (!tabs[path] || activePath === path) return;
    set({
      activePath: path,
      ...projectActiveTab(tabs, path),
    });
    void persistTabs(get().tabOrder, path);
  },

  setCommitMessage: (message: string) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { commitMessage: message });
  },

  setPushError: (error: string | null) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { pushError: error });
  },

  setAiError: (error: string | null) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { aiError: error });
  },

  setAiLoading: (loading: boolean) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { aiLoading: loading });
  },

  setCommitting: (v: boolean) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { committing: v });
  },

  setCommitAndPushing: (v: boolean) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { commitAndPushing: v });
  },

  setPushing: (v: boolean) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { pushing: v });
  },

  setPulling: (v: boolean) => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { pulling: v });
  },

  // --- Path-targeted setters ---
  // Route a partial update to an explicit tab path rather than the active
  // tab. `updateTab` already supports non-active paths: it updates `tabs[path]`
  // and only re-projects the flat active-tab fields when `path === activePath`,
  // so writing to a background tab is safe and shows up once the user returns
  // to it.
  setCommitMessageFor: (path, message) => {
    updateTab(set, get, path, { commitMessage: message });
  },

  setAiErrorFor: (path, error) => {
    updateTab(set, get, path, { aiError: error });
  },

  setAiLoadingFor: (path, loading) => {
    updateTab(set, get, path, { aiLoading: loading });
  },

  refreshStatus: async (force?: boolean) => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    if (!force && tabs[activePath]?.refreshing) return;
    // Skip non-forced refreshes (e.g. the 5-second polling) while a commit or
    // commit&push is in-flight — these operations call refreshStatus(true)
    // themselves when done, so a polling refresh mid-commit would just thrash
    // the UI and race with the operation.
    if (
      !force &&
      (tabs[activePath]?.committing || tabs[activePath]?.commitAndPushing)
    )
      return;
    updateTab(set, get, activePath, { refreshing: true });
    try {
      const statuses = await gitService.getStatus(activePath);
      // Shallow-compare with current data — skip the state update if nothing
      // changed so the polling doesn't trigger unnecessary re-renders.
      const current = get().tabs[activePath]?.fileStatuses ?? [];
      if (!fileStatusesEqual(current, statuses)) {
        updateTab(set, get, activePath, { fileStatuses: statuses });
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    } finally {
      updateTab(set, get, activePath, { refreshing: false });
    }
  },

  refreshRepoInfo: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  selectFile: async (path: string | null) => {
    const { activePath } = get();
    if (!activePath) {
      return;
    }
    updateTab(set, get, activePath, { selectedFile: path });
    if (!path) {
      updateTab(set, get, activePath, { workdirDiff: [], stagedDiff: [] });
      return;
    }
    try {
      const [workdir, staged] = await Promise.all([
        gitService.getWorkdirDiff(activePath, path),
        gitService.getStagedDiff(activePath, path),
      ]);
      // Guard against tab switch during await: only apply if still the same
      // active tab and the user hasn't selected a different file.
      const current = get().tabs[activePath];
      if (current && current.selectedFile === path) {
        updateTab(set, get, activePath, {
          workdirDiff: workdir,
          stagedDiff: staged,
        });
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  stageFiles: async (files: string[]) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.stageFiles(activePath, files);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  unstageFiles: async (files: string[]) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.unstageFiles(activePath, files);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  stageAll: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.stageAll(activePath);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  discardFiles: async (files: string[]) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.discardFiles(activePath, files);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  commit: async (message: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const hash = await gitService.commit(activePath, message);
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return hash;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  amend: async (message: string, includeStaged = false, confirmPushed = false) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const hash = await gitService.amend(activePath, message, includeStaged, confirmPushed);
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return hash;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  push: async (remote?: string, remoteBranch?: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    updateTab(set, get, activePath, { pushing: true, error: null });
    try {
      const result = await gitService.push(activePath, remote, remoteBranch);
      try {
        const info = await gitService.getRepoInfo(activePath);
        updateTab(set, get, activePath, { repoInfo: info });
      } catch {
        // ignore — push itself succeeded
      }
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, activePath, { pushing: false });
    }
  },

  pull: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    updateTab(set, get, activePath, { pulling: true, error: null });
    try {
      const result = await gitService.pull(activePath);
      try {
        await get().refreshStatus(true);
        await get().refreshBranches(true);
        await get().refreshLog(true);
        const info = await gitService.getRepoInfo(activePath);
        updateTab(set, get, activePath, { repoInfo: info });
      } catch {
        // ignore — pull itself succeeded
      }
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, activePath, { pulling: false });
    }
  },

  refreshBranches: async (force?: boolean) => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    if (!force && tabs[activePath]?.refreshing) return;
    updateTab(set, get, activePath, { refreshing: true });
    try {
      const branches = await gitService.listBranches(activePath);
      updateTab(set, get, activePath, { branches });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    } finally {
      updateTab(set, get, activePath, { refreshing: false });
    }
  },

  refreshLog: async (force?: boolean) => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    if (!force && tabs[activePath]?.refreshing) return;
    updateTab(set, get, activePath, { refreshing: true });
    try {
      const log = await gitService.getLog(activePath, 100);
      updateTab(set, get, activePath, { log });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    } finally {
      updateTab(set, get, activePath, { refreshing: false });
    }
  },

  loadRemoteState: async (requestedPath?: string, afterFetch = false) => {
    const path = requestedPath ?? get().activePath;
    if (!path || !get().tabs[path]) return;
    try {
      const [remotes, tracking, repoInfo, branches] = await Promise.all([
        gitService.listRemotes(path),
        gitService.getTrackingInfo(path),
        afterFetch ? gitService.getRepoInfo(path) : Promise.resolve(null),
        afterFetch ? gitService.listBranches(path) : Promise.resolve(null),
      ]);
      if (!get().tabs[path]) return;
      updateTab(set, get, path, {
        remotes,
        tracking,
        remoteError: null,
        ...(repoInfo ? { repoInfo } : {}),
        ...(branches ? { branches } : {}),
        ...(afterFetch ? { fetchUpdatedAt: Date.now() } : {}),
      });
    } catch (e) {
      const message = formatError(e);
      updateTab(set, get, path, { remoteError: message });
      throw e;
    }
  },

  setRemoteBusy: (path, busy) => {
    updateTab(set, get, path, { remoteBusy: busy });
  },

  setRemoteError: (path, error) => {
    updateTab(set, get, path, { remoteError: error });
  },

  setRemoteTask: (path, task) => {
    updateTab(set, get, path, { remoteTask: task });
  },

  switchBranch: async (name: string) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.switchBranch(activePath, name);
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  createBranch: async (name: string) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.createBranch(activePath, name);
      await get().refreshBranches(true);
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  deleteBranch: async (name: string) => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      await gitService.deleteBranch(activePath, name);
      await get().refreshBranches(true);
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  clearError: () => {
    const { activePath } = get();
    if (activePath) updateTab(set, get, activePath, { error: null });
  },

  // --- Patch-level staging ---

  applyPatchToIndex: async (patch: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      await gitService.applyPatchToIndex(activePath, patch);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  applyPatchToIndexReverse: async (patch: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      await gitService.applyPatchToIndexReverse(activePath, patch);
      await get().refreshStatus(true);
      const tab = get().tabs[activePath];
      if (tab?.selectedFile) {
        await get().selectFile(tab.selectedFile);
      }
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  // --- Stash ---

  refreshStashes: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      const stashes = await gitService.listStashes(activePath);
      updateTab(set, get, activePath, { stashes });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  stashSave: async (message, includeUntracked, keepIndex) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.stashSave(
        activePath,
        message,
        includeUntracked,
        keepIndex
      );
      await get().refreshStashes();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  stashApply: async (index: number) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.stashApply(activePath, index);
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  stashPop: async (index: number) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.stashPop(activePath, index);
      await get().refreshStashes();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  stashDrop: async (index: number) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.stashDrop(activePath, index);
      await get().refreshStashes();
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  // --- Tags ---

  refreshTags: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      const tags = await gitService.listTags(activePath);
      updateTab(set, get, activePath, { tags });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  createTag: async (name: string, message?: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.createTag(activePath, name, message);
      await get().refreshTags();
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  deleteTag: async (name: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      await gitService.deleteTag(activePath, name);
      await get().refreshTags();
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  // --- Submodules ---

  refreshSubmodules: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      const submodules = await gitService.listSubmodules(activePath);
      updateTab(set, get, activePath, { submodules });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    }
  },

  updateSubmodule: async (name?: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.updateSubmodule(activePath, name);
      await get().refreshSubmodules();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  addSubmodule: async (url: string, path: string, branch?: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.addSubmodule(
        activePath,
        url,
        path,
        branch
      );
      await get().refreshSubmodules();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  removeSubmodule: async (name: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.removeSubmodule(activePath, name);
      await get().refreshSubmodules();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  // --- Merge / Rebase ---

  mergeBranch: async (branch: string, noFf?: boolean) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    updateTab(set, get, activePath, { merging: true, error: null });
    try {
      const result = await gitService.mergeBranch(activePath, branch, noFf);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshLog(true);
      await get().refreshBranches(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, activePath, { merging: false });
    }
  },

  rebaseBranch: async (branch: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    updateTab(set, get, activePath, { merging: true, error: null });
    try {
      const result = await gitService.rebaseBranch(activePath, branch);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshLog(true);
      await get().refreshBranches(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, activePath, { merging: false });
    }
  },

  abortMerge: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.abortMerge(activePath);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  abortRebase: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.abortRebase(activePath);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  continueMerge: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.continueMerge(activePath);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  continueRebase: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.continueRebase(activePath);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  skipRebase: async () => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.skipRebase(activePath);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  refreshMergeState: async () => {
    const { activePath } = get();
    if (!activePath) return;
    try {
      const operation = await gitService.getOperationState(activePath);
      updateTab(set, get, activePath, {
        operationKind: operation.kind,
        mergeInProgress: operation.in_progress,
        isRebasing: operation.kind === "rebase",
        conflicts: operation.conflicts,
      });
    } catch (e) {
      // Merge-state detection is best-effort — don't surface as a hard error.
      console.warn("[repoStore] refreshMergeState failed:", e);
    }
  },

  resolveOurs: async (files: string[]) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.resolveOurs(activePath, files);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  resolveTheirs: async (files: string[]) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.resolveTheirs(activePath, files);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  // --- History (commit-level operations) ---

  checkoutCommit: async (hash: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      await gitService.checkoutCommit(activePath, hash);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  revertCommit: async (hash: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.revertCommit(activePath, hash);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  cherryPickCommit: async (hash: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      const result = await gitService.cherryPickCommit(activePath, hash);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },

  resetToCommit: async (hash: string, mode: string) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    try {
      await gitService.resetToCommit(activePath, hash, mode);
      await get().refreshMergeState();
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      throw e;
    }
  },
}));
