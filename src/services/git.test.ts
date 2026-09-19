import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { gitService } from "@/services/git";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

describe("gitService secure command contract", () => {
  it("maps status, diff and staging commands to snake_case backend names", async () => {
    await gitService.getStatus("D:/repo");
    await gitService.getWorkdirDiff("D:/repo", "src/a.ts");
    await gitService.getStagedDiff("D:/repo", undefined);
    await gitService.stageFiles("D:/repo", ["src/a.ts"]);
    await gitService.unstageFiles("D:/repo", ["src/b.ts"]);
    await gitService.stageAll("D:/repo");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_status", { path: "D:/repo" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_workdir_diff", {
      path: "D:/repo",
      filePath: "src/a.ts",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "get_staged_diff", {
      path: "D:/repo",
      filePath: undefined,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "stage_files", {
      path: "D:/repo",
      files: ["src/a.ts"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "unstage_files", {
      path: "D:/repo",
      files: ["src/b.ts"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, "stage_all", { path: "D:/repo" });
  });

  it("passes the force flag through when switching branches", async () => {
    await gitService.switchBranch("D:/repo", "feature", false);
    await gitService.switchBranch("D:/repo", "feature", true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "switch_branch", {
      path: "D:/repo",
      name: "feature",
      force: false,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "switch_branch", {
      path: "D:/repo",
      name: "feature",
      force: true,
    });
  });

  it("keeps clone invocations limited to url, targetPath and taskId", async () => {
    await gitService.cloneRepo("https://example.com/repo.git", "D:/code/repo");
    await gitService.cloneRepoTask("https://example.com/repo.git", "D:/code/repo", "task-1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "clone_repo", {
      url: "https://example.com/repo.git",
      targetPath: "D:/code/repo",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "clone_repo_task", {
      url: "https://example.com/repo.git",
      targetPath: "D:/code/repo",
      taskId: "task-1",
    });
  });

  it("sends amend confirmation flags and patch payloads explicitly", async () => {
    await gitService.amend("D:/repo", "fix: x", true, true);
    await gitService.applyPatchToIndex("D:/repo", "diff --git a/x b/x\n");
    await gitService.applyPatchToIndexReverse("D:/repo", "diff --git a/x b/x\n");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "amend", {
      path: "D:/repo",
      message: "fix: x",
      includeStaged: true,
      confirmPushed: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "apply_patch_to_index", {
      path: "D:/repo",
      patch: "diff --git a/x b/x\n",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "apply_patch_to_index_reverse", {
      path: "D:/repo",
      patch: "diff --git a/x b/x\n",
    });
  });

  it("routes history operations with commit hashes as plain strings", async () => {
    await gitService.checkoutCommit("D:/repo", "abc123");
    await gitService.revertCommit("D:/repo", "abc123");
    await gitService.cherryPickCommit("D:/repo", "abc123");
    await gitService.resetToCommit("D:/repo", "abc123", "hard");

    for (const [index, command] of [
      "checkout_commit",
      "revert_commit",
      "cherry_pick_commit",
      "reset_to_commit",
    ].entries()) {
      expect(invokeMock).toHaveBeenNthCalledWith(index + 1, command, expect.anything());
    }
    const resetArgs = invokeMock.mock.calls[3]?.[1] as Record<string, unknown>;
    expect(resetArgs).toMatchObject({ path: "D:/repo", hash: "abc123", mode: "hard" });
  });

  it("maps the release-notes range log to get_log_range with optional bounds", async () => {
    await gitService.getLogRange("D:/repo", "v1.0.0", "v1.1.0", 500);
    await gitService.getLogRange("D:/repo", undefined, undefined, undefined);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_log_range", {
      path: "D:/repo",
      base: "v1.0.0",
      head: "v1.1.0",
      limit: 500,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_log_range", {
      path: "D:/repo",
      base: undefined,
      head: undefined,
      limit: undefined,
    });
  });
});
