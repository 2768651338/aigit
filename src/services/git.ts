import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  FileDiff,
  FileStatus,
  LogEntry,
  MergeResult,
  RepoInfo,
  StashInfo,
  SubmoduleInfo,
  TagInfo,
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

  /**
   * Apply a unified-diff patch to the index (`git apply --cached`).
   * Used by the "stage selected lines" feature in the diff viewer.
   */
  applyPatchToIndex: (path: string, patch: string) => {
    ensureTauri();
    return invoke<void>("apply_patch_to_index", { path, patch });
  },

  /**
   * Reverse-apply a unified-diff patch to the index (`git apply --cached -R`).
   * Used by the "unstage selected lines" feature.
   */
  applyPatchToIndexReverse: (path: string, patch: string) => {
    ensureTauri();
    return invoke<void>("apply_patch_to_index_reverse", { path, patch });
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

  /** List all tracked files in the repository (for the AI chat @file picker). */
  listFiles: (path: string) => {
    ensureTauri();
    return invoke<string[]>("list_files", { path });
  },

  push: (path: string, setUpstream?: boolean) => {
    ensureTauri();
    return invoke<string>("push", { path, setUpstream });
  },

  pull: (path: string) => {
    ensureTauri();
    return invoke<string>("pull", { path });
  },

  discardFiles: (path: string, files: string[]) => {
    ensureTauri();
    return invoke<void>("discard_files", { path, files });
  },

  // --- Stash ---

  listStashes: (path: string) => {
    ensureTauri();
    return invoke<StashInfo[]>("list_stashes", { path });
  },

  stashSave: (
    path: string,
    message?: string,
    includeUntracked?: boolean,
    keepIndex?: boolean
  ) => {
    ensureTauri();
    return invoke<string>("stash_save", {
      path,
      message,
      includeUntracked,
      keepIndex,
    });
  },

  stashApply: (path: string, index: number) => {
    ensureTauri();
    return invoke<string>("stash_apply", { path, index });
  },

  stashPop: (path: string, index: number) => {
    ensureTauri();
    return invoke<string>("stash_pop", { path, index });
  },

  stashDrop: (path: string, index: number) => {
    ensureTauri();
    return invoke<string>("stash_drop", { path, index });
  },

  // --- Tags ---

  listTags: (path: string) => {
    ensureTauri();
    return invoke<TagInfo[]>("list_tags", { path });
  },

  createTag: (path: string, name: string, message?: string) => {
    ensureTauri();
    return invoke<string>("create_tag", { path, name, message });
  },

  deleteTag: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("delete_tag", { path, name });
  },

  // --- Submodules ---

  listSubmodules: (path: string) => {
    ensureTauri();
    return invoke<SubmoduleInfo[]>("list_submodules", { path });
  },

  updateSubmodule: (path: string, name?: string) => {
    ensureTauri();
    return invoke<string>("update_submodule", { path, name });
  },

  addSubmodule: (
    path: string,
    url: string,
    targetPath: string,
    branch?: string
  ) => {
    ensureTauri();
    return invoke<string>("add_submodule", {
      path,
      url,
      targetPath,
      branch,
    });
  },

  removeSubmodule: (path: string, name: string) => {
    ensureTauri();
    return invoke<string>("remove_submodule", { path, name });
  },

  // --- Merge / Rebase ---

  mergeBranch: (path: string, branch: string, noFf?: boolean) => {
    ensureTauri();
    return invoke<MergeResult>("merge_branch", { path, branch, noFf });
  },

  rebaseBranch: (path: string, branch: string) => {
    ensureTauri();
    return invoke<MergeResult>("rebase_branch", { path, branch });
  },

  abortMerge: (path: string) => {
    ensureTauri();
    return invoke<string>("abort_merge", { path });
  },

  abortRebase: (path: string) => {
    ensureTauri();
    return invoke<string>("abort_rebase", { path });
  },

  continueMerge: (path: string) => {
    ensureTauri();
    return invoke<string>("continue_merge", { path });
  },

  continueRebase: (path: string) => {
    ensureTauri();
    return invoke<string>("continue_rebase", { path });
  },

  skipRebase: (path: string) => {
    ensureTauri();
    return invoke<string>("skip_rebase", { path });
  },

  isMerging: (path: string) => {
    ensureTauri();
    return invoke<boolean>("is_merging", { path });
  },

  isRebasing: (path: string) => {
    ensureTauri();
    return invoke<boolean>("is_rebasing", { path });
  },

  resolveOurs: (path: string, files: string[]) => {
    ensureTauri();
    return invoke<string>("resolve_ours", { path, files });
  },

  resolveTheirs: (path: string, files: string[]) => {
    ensureTauri();
    return invoke<string>("resolve_theirs", { path, files });
  },

  listConflictedFiles: (path: string) => {
    ensureTauri();
    return invoke<string[]>("list_conflicted_files", { path });
  },

  // --- History (commit-level operations) ---

  /**
   * Detach HEAD to `hash` and update the working tree (`git checkout <hash>`).
   * Leaves the repo in a detached-HEAD state.
   */
  checkoutCommit: (path: string, hash: string) => {
    ensureTauri();
    return invoke<string>("checkout_commit", { path, hash });
  },

  /**
   * Revert `hash` with a new commit (`git revert <hash> --no-edit`).
   * On conflict the operation is aborted and the conflicting paths are
   * returned in `result.conflicts`.
   */
  revertCommit: (path: string, hash: string) => {
    ensureTauri();
    return invoke<MergeResult>("revert_commit", { path, hash });
  },

  /**
   * Apply `hash` onto the current branch (`git cherry-pick <hash>`).
   * Same conflict semantics as `revertCommit`.
   */
  cherryPickCommit: (path: string, hash: string) => {
    ensureTauri();
    return invoke<MergeResult>("cherry_pick_commit", { path, hash });
  },

  /**
   * Reset the current branch to `hash` (`git reset --<mode> <hash>`).
   * `mode` is "soft" | "mixed" | "hard".
   */
  resetToCommit: (path: string, hash: string, mode: string) => {
    ensureTauri();
    return invoke<string>("reset_to_commit", { path, hash, mode });
  },
};
