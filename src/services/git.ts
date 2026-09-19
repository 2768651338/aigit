import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  CommitGroupResult,
  CommitPlan,
  ConflictFile,
  FileDiff,
  FileContent,
  FileStatus,
  BlameLine,
  BisectState,
  FileTreeEntry,
  HookInfo,
  LogEntry,
  RewriteStep,
  WorktreeInfo,
  MergeResult,
  GitOperationState,
  RepoInfo,
  StageGroupResult,
  StashInfo,
  SubmoduleInfo,
  RemoteInfo,
  ReflogEntry,
  RepositoryInsights,
  RepoHealth,
  TagInfo,
  TrackingInfo,
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

  /** Cancellable clone; pair with `cancelGitTask` using the returned task id. */
  cloneRepoTask: (url: string, targetPath: string, taskId: string) => {
    ensureTauri();
    return invoke<void>("clone_repo_task", { url, targetPath, taskId });
  },

  getRepoInfo: (path: string) => {
    ensureTauri();
    return invoke<RepoInfo>("get_repo_info", { path });
  },

  getStatus: (path: string) => {
    ensureTauri();
    return invoke<FileStatus[]>("get_status", { path });
  },

  /** Append ignore rules to the repo root `.gitignore`; returns the rules actually added. */
  addGitignoreEntries: (path: string, entries: string[]) => {
    ensureTauri();
    return invoke<string[]>("add_gitignore_entries", { path, entries });
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

  amend: (path: string, message: string, includeStaged = false, confirmPushed = false) => {
    ensureTauri();
    return invoke<string>("amend", { path, message, includeStaged, confirmPushed });
  },

  isHeadPushed: (path: string) => {
    ensureTauri();
    return invoke<boolean>("is_head_pushed", { path });
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

  validateSmartCommitPlan: (path: string, plan: CommitPlan) => {
    ensureTauri();
    return invoke<void>("validate_smart_commit_plan", { path, plan });
  },

  stageSmartCommitGroup: (path: string, plan: CommitPlan, groupId: string) => {
    ensureTauri();
    return invoke<StageGroupResult>("stage_smart_commit_group", { path, plan, groupId });
  },

  commitSmartCommitGroup: (
    path: string,
    plan: CommitPlan,
    groupId: string,
    stagedTree: string,
  ) => {
    ensureTauri();
    return invoke<CommitGroupResult>("commit_smart_commit_group", {
      path,
      plan,
      groupId,
      stagedTree,
    });
  },

  listBranches: (path: string) => {
    ensureTauri();
    return invoke<BranchInfo[]>("list_branches", { path });
  },

  /** Aggregated repo health report; display thresholds come from settings. */
  getRepoHealth: (path: string, thresholds: { staleDays: number; largeFileMinMb: number; largeFileTopN: number }) => {
    ensureTauri();
    return invoke<RepoHealth>("get_repo_health", {
      path,
      staleDays: thresholds.staleDays,
      largeFileMinMb: thresholds.largeFileMinMb,
      largeFileTopN: thresholds.largeFileTopN,
    });
  },

  createBranch: (path: string, name: string, startPoint?: string) => {
    ensureTauri();
    return invoke<void>("create_branch", { path, name, startPoint });
  },

  switchBranch: (path: string, name: string, force = false) => {
    ensureTauri();
    return invoke<void>("switch_branch", { path, name, force });
  },

  deleteBranch: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("delete_branch", { path, name });
  },

  getLog: (path: string, limit?: number, offset?: number) => {
    ensureTauri();
    return invoke<LogEntry[]>("get_log", { path, limit, offset });
  },

  /** Commits between two rev expressions (tags/branches/hashes) for release notes. */
  getLogRange: (path: string, base?: string, head?: string, limit?: number) => {
    ensureTauri();
    return invoke<LogEntry[]>("get_log_range", { path, base, head, limit });
  },

  /** Recent HEAD movements for the recovery panel. */
  listHeadReflog: (path: string) => {
    ensureTauri();
    return invoke<ReflogEntry[]>("list_head_reflog", { path });
  },

  getRepositoryInsights: (path: string, startDate?: string, endDate?: string) => {
    ensureTauri();
    return invoke<RepositoryInsights>("get_repository_insights", { path, startDate, endDate });
  },

  /** Structured per-file diff of a commit against its first parent. */
  getCommitFiles: (path: string, hash: string) => {
    ensureTauri();
    return invoke<FileDiff[]>("get_commit_diff_files", { path, hash });
  },

  /** List all tracked files in the repository (for the AI chat @file picker). */
  listFiles: (path: string) => {
    ensureTauri();
    return invoke<string[]>("list_files", { path });
  },

  /** List one directory of the tracked tree (file browser, lazy per dir). */
  listTree: (path: string, dir?: string) => {
    ensureTauri();
    return invoke<FileTreeEntry[]>("list_tree", { path, dir });
  },

  /** Commits that touched one file, newest first. */
  getFileHistory: (path: string, filePath: string, limit?: number) => {
    ensureTauri();
    return invoke<LogEntry[]>("get_file_history", { path, filePath, limit });
  },

  /** Per-line blame attribution of a file at HEAD. */
  getFileBlame: (path: string, filePath: string) => {
    ensureTauri();
    return invoke<BlameLine[]>("get_file_blame", { path, filePath });
  },

  /** Binary-detected, size-capped worktree file preview. */
  getFileContent: (path: string, filePath: string) => {
    ensureTauri();
    return invoke<FileContent>("get_file_content", { path, filePath });
  },

  /** Structured diff of one commit limited to a single file. */
  getCommitFileDiff: (path: string, hash: string, filePath: string) => {
    ensureTauri();
    return invoke<FileDiff[]>("get_commit_file_diff", { path, hash, filePath });
  },

  /** Dry-run a unified diff against the index (`git apply --check --cached`). */
  validatePatchApplies: (path: string, patch: string) => {
    ensureTauri();
    return invoke<boolean>("validate_patch_applies", { path, patch });
  },

  /** List linked worktrees of this repository. */
  listWorktrees: (path: string) => {
    ensureTauri();
    return invoke<WorktreeInfo[]>("list_worktrees", { path });
  },

  /** Create a linked worktree, optionally checking out a branch. */
  addWorktree: (path: string, name: string, worktreePath: string, branch?: string) => {
    ensureTauri();
    return invoke<string>("add_worktree", { path, name, worktreePath, branch });
  },

  /** Prune a linked worktree; with force the working directory is deleted. */
  removeWorktree: (path: string, name: string, force: boolean) => {
    ensureTauri();
    return invoke<void>("remove_worktree", { path, name, force });
  },

  /** List known git hook slots and whether a script exists for each. */
  listHooks: (path: string) => {
    ensureTauri();
    return invoke<HookInfo[]>("list_hooks", { path });
  },

  /** Read one hook script (empty when it does not exist). */
  getHookContent: (path: string, name: string) => {
    ensureTauri();
    return invoke<string>("get_hook_content", { path, name });
  },

  /** Write one hook script (validated against the hook-name whitelist). */
  saveHookContent: (path: string, name: string, content: string) => {
    ensureTauri();
    return invoke<void>("save_hook_content", { path, name, content });
  },

  /** Current `git bisect` session state. */
  getBisectState: (path: string) => {
    ensureTauri();
    return invoke<BisectState>("get_bisect_state", { path });
  },

  /** Start a bisect session, optionally seeding bad/good commits. */
  bisectStart: (path: string, bad?: string, good?: string) => {
    ensureTauri();
    return invoke<BisectState>("bisect_start", { path, bad, good });
  },

  /** Mark the current commit good/bad/skip. */
  bisectMark: (path: string, verdict: "good" | "bad" | "skip", commit?: string) => {
    ensureTauri();
    return invoke<BisectState>("bisect_mark", { path, verdict, commit });
  },

  /** End the bisect session and return to the original HEAD. */
  bisectReset: (path: string) => {
    ensureTauri();
    return invoke<void>("bisect_reset", { path });
  },

  /** Rewrite the branch tail: reword / squash / drop (oldest first). */
  rewriteHistory: (path: string, steps: RewriteStep[]) => {
    ensureTauri();
    return invoke<string>("rewrite_history", { path, steps });
  },

  listRemotes: (path: string) => {
    ensureTauri();
    return invoke<RemoteInfo[]>("list_remotes", { path });
  },

  addRemote: (path: string, name: string, url: string) => {
    ensureTauri();
    return invoke<void>("add_remote", { path, name, url });
  },

  editRemote: (path: string, oldName: string, newName: string, url: string) => {
    ensureTauri();
    return invoke<void>("edit_remote", { path, oldName, newName, url });
  },

  removeRemote: (path: string, name: string) => {
    ensureTauri();
    return invoke<void>("remove_remote", { path, name });
  },

  renameRemote: (path: string, oldName: string, newName: string) => {
    ensureTauri();
    return invoke<void>("rename_remote", { path, oldName, newName });
  },

  setRemoteUrl: (path: string, name: string, url: string, push = false) => {
    ensureTauri();
    return invoke<void>("set_remote_url", { path, name, url, push });
  },

  getTrackingInfo: (path: string) => {
    ensureTauri();
    return invoke<TrackingInfo>("get_tracking_info", { path });
  },

  setUpstream: (path: string, remote: string, remoteBranch: string) => {
    ensureTauri();
    return invoke<TrackingInfo>("set_upstream", { path, remote, remoteBranch });
  },

  fetch: (path: string, remote?: string, prune = false, tags = false) => {
    ensureTauri();
    return invoke<string>("fetch", { path, remote, prune, tags });
  },

  push: (path: string, remote?: string, remoteBranch?: string) => {
    ensureTauri();
    return invoke<string>("push", { path, remote, remoteBranch });
  },

  pull: (path: string) => {
    ensureTauri();
    return invoke<string>("pull", { path });
  },

  fetchTask: (path: string, taskId: string, remote?: string, prune = false, tags = false) => {
    ensureTauri();
    return invoke<string>("fetch_task", { path, taskId, remote, prune, tags });
  },

  pushTask: (path: string, taskId: string, remote?: string, remoteBranch?: string) => {
    ensureTauri();
    return invoke<string>("push_task", { path, taskId, remote, remoteBranch });
  },

  pullTask: (path: string, taskId: string) => {
    ensureTauri();
    return invoke<string>("pull_task", { path, taskId });
  },

  cancelGitTask: (taskId: string) => {
    ensureTauri();
    return invoke<boolean>("cancel_git_task", { taskId });
  },

  createTrackingBranch: (path: string, remoteBranch: string, localName?: string) => {
    ensureTauri();
    return invoke<string>("create_tracking_branch", { path, remoteBranch, localName });
  },

  pushTag: (path: string, remote: string, tag: string) => {
    ensureTauri();
    return invoke<string>("push_tag", { path, remote, tag });
  },

  deleteRemoteTag: (path: string, remote: string, tag: string) => {
    ensureTauri();
    return invoke<string>("delete_remote_tag", { path, remote, tag });
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

  getOperationState: (path: string) => {
    ensureTauri();
    return invoke<GitOperationState>("get_operation_state", { path });
  },

  listConflictDetails: (path: string) => {
    ensureTauri();
    return invoke<ConflictFile[]>("list_conflict_details", { path });
  },

  saveConflictResolution: (path: string, filePath: string, content: string) => {
    ensureTauri();
    return invoke<void>("save_conflict_resolution", { path, filePath, content });
  },

  continueOperation: (path: string) => {
    ensureTauri();
    return invoke<string>("continue_operation", { path });
  },

  skipOperation: (path: string) => {
    ensureTauri();
    return invoke<string>("skip_operation", { path });
  },

  abortOperation: (path: string) => {
    ensureTauri();
    return invoke<string>("abort_operation", { path });
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
