import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  LogEntry,
  RepoInfo,
} from "@/types";
import { isTauriEnv } from "@/utils/env";

function ensureTauri(): void {
  if (!isTauriEnv()) {
    throw new Error(
      "此功能仅在 Tauri 桌面应用中可用。请在资源管理器中双击运行 aigit.exe，而不是在浏览器中访问。"
    );
  }
}

export const gitService = {
  discoverRepo: (path: string) => {
    ensureTauri();
    return invoke<string>("discover_repo", { path });
  },

  initRepo: (path: string) => {
    ensureTauri();
    return invoke<void>("init_repo", { path });
  },

  cloneRepo: (url: string, targetPath: string) => {
    ensureTauri();
    return invoke<void>("clone_repo", { url, targetPath });
  },

  getRepoInfo: (path: string) => {
    ensureTauri();
    return invoke<RepoInfo>("get_repo_info", { path });
  },

  getStatus: (path: string) => {
    ensureTauri();
    return invoke<FileStatus[]>("get_status", { path });
  },

  getWorkdirDiff: (path: string, filePath?: string) => {
    ensureTauri();
    return invoke<FileDiff[]>("get_workdir_diff", { path, filePath });
  },

  getStagedDiff: (path: string, filePath?: string) => {
    ensureTauri();
    return invoke<FileDiff[]>("get_staged_diff", { path, filePath });
  },

  stageFiles: (path: string, files: string[]) => {
    ensureTauri();
    return invoke<void>("stage_files", { path, files });
  },

  stageAll: (path: string) => {
    ensureTauri();
    return invoke<void>("stage_all", { path });
  },

  unstageFiles: (path: string, files: string[]) => {
    ensureTauri();
    return invoke<void>("unstage_files", { path, files });
  },

  commit: (path: string, message: string) => {
    ensureTauri();
    return invoke<string>("commit", { path, message });
  },

  amendMessage: (path: string, message: string) => {
    ensureTauri();
    return invoke<string>("amend_message", { path, message });
  },

  listBranches: (path: string) => {
    ensureTauri();
    return invoke<BranchInfo[]>("list_branches", { path });
  },

  createBranch: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("create_branch", { path, name });
  },

  switchBranch: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("switch_branch", { path, name });
  },

  deleteBranch: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("delete_branch", { path, name });
  },

  getLog: (path: string, limit?: number) => {
    ensureTauri();
    return invoke<LogEntry[]>("get_log", { path, limit });
  },

  getCommitDiff: (path: string, hash: string) => {
    ensureTauri();
    return invoke<string>("get_commit_diff", { path, hash });
  },

  push: (path: string, setUpstream?: boolean) => {
    ensureTauri();
    return invoke<string>("push", { path, setUpstream });
  },
};
