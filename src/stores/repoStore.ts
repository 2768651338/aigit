import { create } from "zustand";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  LogEntry,
  RepoInfo,
} from "@/types";
import { gitService } from "@/services/git";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";

interface RepoState {
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

  openRepo: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  stageFiles: (files: string[]) => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: (setUpstream?: boolean) => Promise<string>;
  refreshBranches: () => Promise<void>;
  refreshLog: () => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  clearError: () => void;
}

export const useRepoStore = create<RepoState>((set, get) => ({
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

  openRepo: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const info = await gitService.getRepoInfo(path);
      await configService.addRecentRepo(path);
      set({ currentPath: path, repoInfo: info });
      await get().refreshStatus();
      await get().refreshBranches();
      await get().refreshLog();
    } catch (e) {
      set({ error: formatError(e) });
    } finally {
      set({ loading: false });
    }
  },

  refreshStatus: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      const statuses = await gitService.getStatus(currentPath);
      set({ fileStatuses: statuses });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  selectFile: async (path: string | null) => {
    const { currentPath } = get();
    set({ selectedFile: path });
    if (!currentPath || !path) {
      set({ workdirDiff: [], stagedDiff: [] });
      return;
    }
    try {
      const [workdir, staged] = await Promise.all([
        gitService.getWorkdirDiff(currentPath, path),
        gitService.getStagedDiff(currentPath, path),
      ]);
      set({ workdirDiff: workdir, stagedDiff: staged });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  stageFiles: async (files: string[]) => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.stageFiles(currentPath, files);
      await get().refreshStatus();
      const { selectedFile } = get();
      if (selectedFile) {
        await get().selectFile(selectedFile);
      }
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  unstageFiles: async (files: string[]) => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.unstageFiles(currentPath, files);
      await get().refreshStatus();
      const { selectedFile } = get();
      if (selectedFile) {
        await get().selectFile(selectedFile);
      }
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  stageAll: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.stageAll(currentPath);
      await get().refreshStatus();
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  commit: async (message: string) => {
    const { currentPath } = get();
    if (!currentPath) throw new Error("No repository open");
    try {
      const hash = await gitService.commit(currentPath, message);
      await get().refreshStatus();
      await get().refreshLog();
      return hash;
    } catch (e) {
      set({ error: formatError(e) });
      throw e;
    }
  },

  push: async (setUpstream?: boolean) => {
    const { currentPath } = get();
    if (!currentPath) throw new Error("No repository open");
    set({ pushing: true, error: null });
    try {
      const result = await gitService.push(currentPath, setUpstream);
      // Refresh repo info to update ahead/behind counters.
      try {
        const info = await gitService.getRepoInfo(currentPath);
        set({ repoInfo: info });
      } catch {
        // ignore — push itself succeeded
      }
      return result;
    } catch (e) {
      const msg = formatError(e);
      set({ error: msg });
      throw e;
    } finally {
      set({ pushing: false });
    }
  },

  refreshBranches: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      const branches = await gitService.listBranches(currentPath);
      set({ branches });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  refreshLog: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      const log = await gitService.getLog(currentPath, 100);
      set({ log });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  switchBranch: async (name: string) => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.switchBranch(currentPath, name);
      await get().refreshStatus();
      await get().refreshBranches();
      await get().refreshLog();
      const info = await gitService.getRepoInfo(currentPath);
      set({ repoInfo: info });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  createBranch: async (name: string) => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.createBranch(currentPath, name);
      await get().refreshBranches();
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  deleteBranch: async (name: string) => {
    const { currentPath } = get();
    if (!currentPath) return;
    try {
      await gitService.deleteBranch(currentPath, name);
      await get().refreshBranches();
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  clearError: () => set({ error: null }),
}));
