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
import { appFlags } from "@/utils/appFlags";
import { formatError, isErrorDto } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import i18n from "@/i18n";
import { createPanelSlice } from "./repoStorePanels";

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

export interface RepoStoreState extends ActiveTabProjection {
  /** Source of truth: per-repo state keyed by absolute path. */
  tabs: Record<string, RepoTabState>;
  /** Path of the currently active tab. `null` when no tab is open. */
  activePath: string | null;
  /** Ordered list of open repo paths (shown in the sidebar). */
  tabOrder: string[];

  // Tab-level actions
  /** Open a repo in a new tab (or activate it if already open). */
  openRepo: (path: string) => Promise<void>;
  /** Close a tab. If it was active, activate the previous tab (or null). */
  closeRepoTab: (path: string) => Promise<void>;
  /** Switch the active tab. */
  setActiveRepo: (path: string) => void;
  /**
   * Reorder the open-repo list by moving `draggedPath` before/after
   * `targetPath`. No-op when either path is unknown, both match, or the
   * resulting order is unchanged.
   */
  moveRepoTab: (draggedPath: string, targetPath: string, position: "before" | "after") => void;

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
  setPushErrorFor: (path: string, error: string | null) => void;
  setCommittingFor: (path: string, v: boolean) => void;
  setCommitAndPushingFor: (path: string, v: boolean) => void;

  // Git operations. The path is passed explicitly (pinned by the caller when
  // the flow starts) so an `await` straddling a tab switch can never redirect
  // the operation to another repo.
  refreshStatus: (force?: boolean) => Promise<void>;
  refreshRepoInfo: () => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  stageFiles: (files: string[]) => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  discardFiles: (files: string[]) => Promise<void>;
  commit: (path: string, message: string) => Promise<string>;
  amend: (path: string, message: string, includeStaged?: boolean, confirmPushed?: boolean) => Promise<string>;
  push: (path: string, remote?: string, remoteBranch?: string) => Promise<string>;
  pull: (path: string) => Promise<string>;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshLog: (force?: boolean) => Promise<void>;
  loadRemoteState: (path?: string, afterFetch?: boolean) => Promise<void>;
  setRemoteBusy: (path: string, busy: string | null) => void;
  setRemoteError: (path: string, error: string | null) => void;
  setRemoteTask: (path: string, task: RepoTabState["remoteTask"]) => void;
  switchBranch: (name: string, force?: boolean) => Promise<boolean>;
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
 * Latest status-request sequence number per repo path. `refreshStatus(true)`
 * bypasses the `refreshing` guard and can overlap an in-flight poll, so the
 * older request's response would otherwise land *after* the newer one and
 * overwrite fresh data with stale data ("edits made but UI shows no changes").
 * Responses are only applied when their sequence is still the newest.
 */
const statusRequestSeq = new Map<string, number>();

function nextStatusSeq(path: string): number {
  const next = (statusRequestSeq.get(path) ?? 0) + 1;
  statusRequestSeq.set(path, next);
  return next;
}

function isLatestStatusSeq(path: string, seq: number): boolean {
  return statusRequestSeq.get(path) === seq;
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
    // When "remember open repos" is off, persist an empty set so the next
    // launch starts with no tabs. Defaults to remembering until App mirrors
    // the loaded config into appFlags (matches the backend default).
    await configService.setOpenRepos(
      appFlags.rememberOpenRepos ? tabOrder : [],
      appFlags.rememberOpenRepos ? activePath : null,
    );
  } catch (e) {
    // Persistence is best-effort — don't block UI on config write failures.
    console.warn("[repoStore] Failed to persist open tabs:", e);
  }
}

/** Refresh actions a repo-scoped operation may trigger after succeeding. */
type RepoOpRefresh =
  | "status"
  | "branches"
  | "log"
  | "stashes"
  | "tags"
  | "submodules"
  | "mergeState";

export const useRepoStore = create<RepoStoreState>((set, get) => {
  /**
   * Shared skeleton for repo-scoped actions. Pins the operation to the
   * currently active repo, runs it, applies the requested refreshes, and
   * funnels errors into the tab's error banner. Mutating ops rethrow after
   * recording (`rethrow` defaults to true); background refreshes pass
   * `rethrow: false` to swallow errors — and may therefore resolve to
   * undefined when no repo is open or the op fails.
   */
  function runRepoOp<T>(
    run: (repoPath: string) => Promise<T>,
    options: {
      refresh?: RepoOpRefresh[];
      rethrow: false;
      before?: Partial<RepoTabState>;
      after?: Partial<RepoTabState>;
      withRepoInfo?: boolean;
    }
  ): Promise<T | undefined>;
  function runRepoOp<T>(
    run: (repoPath: string) => Promise<T>,
    options?: {
      refresh?: RepoOpRefresh[];
      rethrow?: true;
      before?: Partial<RepoTabState>;
      after?: Partial<RepoTabState>;
      withRepoInfo?: boolean;
    }
  ): Promise<T>;
  async function runRepoOp<T>(
    run: (repoPath: string) => Promise<T>,
    options: {
      refresh?: RepoOpRefresh[];
      rethrow?: boolean;
      before?: Partial<RepoTabState>;
      after?: Partial<RepoTabState>;
      withRepoInfo?: boolean;
    } = {}
  ): Promise<T | undefined> {
    const { activePath } = get();
    if (!activePath) {
      if (options.rethrow === false) return undefined;
      throw new Error("No repository open");
    }
    if (options.before) {
      updateTab(set, get, activePath, { error: null, ...options.before });
    }
    try {
      const result = await run(activePath);
      for (const key of options.refresh ?? []) {
        if (key === "status") await get().refreshStatus(true);
        else if (key === "branches") await get().refreshBranches(true);
        else if (key === "log") await get().refreshLog(true);
        else if (key === "stashes") await get().refreshStashes();
        else if (key === "tags") await get().refreshTags();
        else if (key === "submodules") await get().refreshSubmodules();
        else await get().refreshMergeState();
      }
      if (options.withRepoInfo) {
        const info = await gitService.getRepoInfo(activePath);
        updateTab(set, get, activePath, { repoInfo: info });
      }
      return result;
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
      if (options.rethrow !== false) throw e;
      return undefined;
    } finally {
      if (options.after) updateTab(set, get, activePath, options.after);
    }
  };

  return {
  tabs: {},
  activePath: null,
  tabOrder: [],
  ...projectActiveTab({}, null),

  // Panel-domain actions (stash / tags / submodules / merge / history) live
  // in repoStorePanels.ts; they share this store's runRepoOp runner.
  ...createPanelSlice(runRepoOp),

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

  moveRepoTab: (draggedPath, targetPath, position) => {
    const { tabOrder, activePath } = get();
    if (draggedPath === targetPath) return;
    if (!tabOrder.includes(draggedPath) || !tabOrder.includes(targetPath))
      return;
    const withoutDragged = tabOrder.filter((p) => p !== draggedPath);
    const targetIdx = withoutDragged.indexOf(targetPath);
    if (targetIdx === -1) return;
    const insertAt = position === "after" ? targetIdx + 1 : targetIdx;
    // Re-attaching at the dragged item's original slot is not a reorder —
    // skip the state update and the config write entirely.
    const nextTabOrder = [...withoutDragged];
    nextTabOrder.splice(insertAt, 0, draggedPath);
    if (
      nextTabOrder.length === tabOrder.length &&
      nextTabOrder.every((p, i) => p === tabOrder[i])
    )
      return;
    set({ tabOrder: nextTabOrder });
    void persistTabs(nextTabOrder, activePath);
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

  setPushErrorFor: (path, error) => {
    updateTab(set, get, path, { pushError: error });
  },

  setCommittingFor: (path, v) => {
    updateTab(set, get, path, { committing: v });
  },

  setCommitAndPushingFor: (path, v) => {
    updateTab(set, get, path, { commitAndPushing: v });
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
    const seq = nextStatusSeq(activePath);
    try {
      const statuses = await gitService.getStatus(activePath);
      // A newer refresh superseded this one — drop the stale response instead
      // of overwriting fresher state.
      if (!isLatestStatusSeq(activePath, seq)) return;
      // Shallow-compare with current data — skip the state update if nothing
      // changed so the polling doesn't trigger unnecessary re-renders.
      const current = get().tabs[activePath]?.fileStatuses ?? [];
      if (!fileStatusesEqual(current, statuses)) {
        updateTab(set, get, activePath, { fileStatuses: statuses });
      }
    } catch (e) {
      if (!isLatestStatusSeq(activePath, seq)) return;
      updateTab(set, get, activePath, { error: formatError(e) });
    } finally {
      // Only the newest request may clear `refreshing`; an older request
      // finishing late must not unlock polling while a newer one is in
      // flight.
      if (isLatestStatusSeq(activePath, seq)) {
        updateTab(set, get, activePath, { refreshing: false });
      }
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

  commit: async (path: string, message: string) => {
    if (!get().tabs[path]) throw new Error("Repository is not open");
    try {
      const hash = await gitService.commit(path, message);
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return hash;
    } catch (e) {
      updateTab(set, get, path, { error: formatError(e) });
      throw e;
    }
  },

  amend: async (path: string, message: string, includeStaged = false, confirmPushed = false) => {
    if (!get().tabs[path]) throw new Error("Repository is not open");
    try {
      const hash = await gitService.amend(path, message, includeStaged, confirmPushed);
      await get().refreshStatus(true);
      await get().refreshLog(true);
      return hash;
    } catch (e) {
      updateTab(set, get, path, { error: formatError(e) });
      throw e;
    }
  },

  push: async (path: string, remote?: string, remoteBranch?: string) => {
    if (!get().tabs[path]) throw new Error("Repository is not open");
    updateTab(set, get, path, { pushing: true, error: null });
    try {
      const result = await gitService.push(path, remote, remoteBranch);
      try {
        const info = await gitService.getRepoInfo(path);
        updateTab(set, get, path, { repoInfo: info });
      } catch {
        // ignore — push itself succeeded
      }
      return result;
    } catch (e) {
      updateTab(set, get, path, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, path, { pushing: false });
    }
  },

  pull: async (path: string) => {
    if (!get().tabs[path]) throw new Error("Repository is not open");
    updateTab(set, get, path, { pulling: true, error: null });
    try {
      const result = await gitService.pull(path);
      try {
        await get().refreshStatus(true);
        await get().refreshBranches(true);
        await get().refreshLog(true);
        const info = await gitService.getRepoInfo(path);
        updateTab(set, get, path, { repoInfo: info });
      } catch {
        // ignore — pull itself succeeded
      }
      return result;
    } catch (e) {
      updateTab(set, get, path, { error: formatError(e) });
      throw e;
    } finally {
      updateTab(set, get, path, { pulling: false });
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

  /** Returns false when the switch was declined or failed, true when switched. */
  switchBranch: async (name: string, force = false): Promise<boolean> => {
    const { activePath } = get();
    if (!activePath) return false;
    try {
      await gitService.switchBranch(activePath, name, force);
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
      const info = await gitService.getRepoInfo(activePath);
      updateTab(set, get, activePath, { repoInfo: info });
      return true;
    } catch (e) {
      if (!force && isErrorDto(e) && e.code === "uncommitted_changes") {
        // 后端拒绝覆盖未提交改动；仅在用户显式确认丢弃后才强制切换。
        const confirmed = await confirmDialog(
          i18n.t("branches.forceSwitchTitle"),
          i18n.t("branches.forceSwitchMessage", { name })
        );
        if (confirmed) {
          return get().switchBranch(name, true);
        }
        return false;
      }
      updateTab(set, get, activePath, { error: formatError(e) });
      return false;
    }
  },

  createBranch: async (name: string) =>
    runRepoOp((repoPath) => gitService.createBranch(repoPath, name), {
      refresh: ["branches"],
      rethrow: false,
    }),

  deleteBranch: async (name: string) =>
    runRepoOp((repoPath) => gitService.deleteBranch(repoPath, name), {
      refresh: ["branches"],
      rethrow: false,
    }),

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

  // --- Merge / Rebase ---

  // --- Merge / Rebase / History actions live in repoStorePanels.ts ---

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

  };
});