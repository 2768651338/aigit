import type { RepoTabState } from "@/types";
import { gitService } from "@/services/git";
import type { RepoStoreState } from "./repoStore";

/** Refresh actions a repo-scoped operation may trigger after succeeding. */
export type RepoOpRefresh =
  | "status"
  | "branches"
  | "log"
  | "stashes"
  | "tags"
  | "submodules"
  | "mergeState";

/** Shape of the repoStore's shared operation runner (see repoStore.ts). */
export type RunRepoOp = <T>(
  run: (repoPath: string) => Promise<T>,
  options?: {
    refresh?: RepoOpRefresh[];
    rethrow?: true;
    before?: Partial<RepoTabState>;
    after?: Partial<RepoTabState>;
    withRepoInfo?: boolean;
  }
) => Promise<T>;

/**
 * Panel-domain actions: stash, tags, submodules, merge/rebase and the
 * commit-level history operations. All of them are thin `runRepoOp` wrappers
 * pinned to the active repo; the refresh hooks live in the core store.
 */
export type PanelSlice = Pick<
  RepoStoreState,
  | "stashSave"
  | "stashApply"
  | "stashPop"
  | "stashDrop"
  | "createTag"
  | "deleteTag"
  | "updateSubmodule"
  | "addSubmodule"
  | "removeSubmodule"
  | "mergeBranch"
  | "rebaseBranch"
  | "abortMerge"
  | "abortRebase"
  | "continueMerge"
  | "continueRebase"
  | "skipRebase"
  | "resolveOurs"
  | "resolveTheirs"
  | "checkoutCommit"
  | "revertCommit"
  | "cherryPickCommit"
  | "resetToCommit"
>;

export function createPanelSlice(runRepoOp: RunRepoOp): PanelSlice {
  return {
    stashSave: async (message, includeUntracked, keepIndex) =>
      runRepoOp(
        (repoPath) =>
          gitService.stashSave(repoPath, message, includeUntracked, keepIndex),
        { refresh: ["stashes", "status"] }
      ),

    stashApply: async (index: number) =>
      runRepoOp((repoPath) => gitService.stashApply(repoPath, index), {
        refresh: ["status"],
      }),

    stashPop: async (index: number) =>
      runRepoOp((repoPath) => gitService.stashPop(repoPath, index), {
        refresh: ["stashes", "status"],
      }),

    stashDrop: async (index: number) =>
      runRepoOp((repoPath) => gitService.stashDrop(repoPath, index), {
        refresh: ["stashes"],
      }),

    createTag: async (name: string, message?: string) =>
      runRepoOp((repoPath) => gitService.createTag(repoPath, name, message), {
        refresh: ["tags"],
      }),

    deleteTag: async (name: string) =>
      runRepoOp((repoPath) => gitService.deleteTag(repoPath, name), {
        refresh: ["tags"],
      }),

    updateSubmodule: async (name?: string) =>
      runRepoOp((repoPath) => gitService.updateSubmodule(repoPath, name), {
        refresh: ["submodules", "status"],
      }),

    addSubmodule: async (url: string, path: string, branch?: string) =>
      runRepoOp(
        (repoPath) => gitService.addSubmodule(repoPath, url, path, branch),
        { refresh: ["submodules", "status"] }
      ),

    removeSubmodule: async (name: string) =>
      runRepoOp((repoPath) => gitService.removeSubmodule(repoPath, name), {
        refresh: ["submodules", "status"],
      }),

    mergeBranch: async (branch: string, noFf?: boolean) =>
      runRepoOp((repoPath) => gitService.mergeBranch(repoPath, branch, noFf), {
        refresh: ["mergeState", "status", "log", "branches"],
        withRepoInfo: true,
        before: { merging: true },
        after: { merging: false },
      }),

    rebaseBranch: async (branch: string) =>
      runRepoOp((repoPath) => gitService.rebaseBranch(repoPath, branch), {
        refresh: ["mergeState", "status", "log", "branches"],
        withRepoInfo: true,
        before: { merging: true },
        after: { merging: false },
      }),

    abortMerge: async () =>
      runRepoOp((repoPath) => gitService.abortMerge(repoPath), {
        refresh: ["mergeState", "status"],
      }),

    abortRebase: async () =>
      runRepoOp((repoPath) => gitService.abortRebase(repoPath), {
        refresh: ["mergeState", "status"],
      }),

    continueMerge: async () =>
      runRepoOp((repoPath) => gitService.continueMerge(repoPath), {
        refresh: ["mergeState", "status", "log"],
      }),

    continueRebase: async () =>
      runRepoOp((repoPath) => gitService.continueRebase(repoPath), {
        refresh: ["mergeState", "status", "log"],
      }),

    skipRebase: async () =>
      runRepoOp((repoPath) => gitService.skipRebase(repoPath), {
        refresh: ["mergeState", "status", "log"],
      }),

    resolveOurs: async (files: string[]) =>
      runRepoOp((repoPath) => gitService.resolveOurs(repoPath, files), {
        refresh: ["mergeState", "status"],
      }),

    resolveTheirs: async (files: string[]) =>
      runRepoOp((repoPath) => gitService.resolveTheirs(repoPath, files), {
        refresh: ["mergeState", "status"],
      }),

    checkoutCommit: async (hash: string) => {
      await runRepoOp((repoPath) => gitService.checkoutCommit(repoPath, hash), {
        refresh: ["mergeState", "status", "branches", "log"],
        withRepoInfo: true,
      });
    },

    revertCommit: async (hash: string) =>
      runRepoOp((repoPath) => gitService.revertCommit(repoPath, hash), {
        refresh: ["mergeState", "status", "branches", "log"],
        withRepoInfo: true,
      }),

    cherryPickCommit: async (hash: string) =>
      runRepoOp((repoPath) => gitService.cherryPickCommit(repoPath, hash), {
        refresh: ["mergeState", "status", "branches", "log"],
        withRepoInfo: true,
      }),

    resetToCommit: async (hash: string, mode: string) => {
      await runRepoOp(
        (repoPath) => gitService.resetToCommit(repoPath, hash, mode),
        {
          refresh: ["mergeState", "status", "branches", "log"],
          withRepoInfo: true,
        }
      );
    },
  };
}
