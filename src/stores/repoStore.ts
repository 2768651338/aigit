import { create } from "zustand";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  LogEntry,
  RepoInfo,
  RepoTabState,
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

  // Git operations (operate on the active tab)
  refreshStatus: (force?: boolean) => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  stageFiles: (files: string[]) => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  discardFiles: (files: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: (setUpstream?: boolean) => Promise<string>;
  pull: () => Promise<string>;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshLog: (force?: boolean) => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  clearError: () => void;
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

      // Refresh the new tab's data. These read `activePath`, which is now
      // `path`, so they'll update the correct tab.
      await get().refreshStatus(true);
      await get().refreshBranches(true);
      await get().refreshLog(true);
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

  refreshStatus: async (force?: boolean) => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    if (!force && tabs[activePath]?.refreshing) return;
    updateTab(set, get, activePath, { refreshing: true });
    try {
      const statuses = await gitService.getStatus(activePath);
      updateTab(set, get, activePath, { fileStatuses: statuses });
    } catch (e) {
      updateTab(set, get, activePath, { error: formatError(e) });
    } finally {
      updateTab(set, get, activePath, { refreshing: false });
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

  push: async (setUpstream?: boolean) => {
    const { activePath } = get();
    if (!activePath) throw new Error("No repository open");
    updateTab(set, get, activePath, { pushing: true, error: null });
    try {
      const result = await gitService.push(activePath, setUpstream);
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
}));
