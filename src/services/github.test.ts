import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { githubService } from "@/services/github";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

describe("githubService command contract", () => {
  it("drafts a release with tag, title and notes as plain strings", async () => {
    await githubService.releaseCreate("D:/repo", "v1.1.0", "v1.1.0", "## 新功能\n- 拖拽排序");

    expect(invokeMock).toHaveBeenCalledWith("github_release_create", {
      path: "D:/repo",
      remote: undefined,
      tagName: "v1.1.0",
      name: "v1.1.0",
      body: "## 新功能\n- 拖拽排序",
    });
  });

  it("keeps the gh status probe on its dedicated command", async () => {
    await githubService.ghStatus("D:/repo");
    expect(invokeMock).toHaveBeenCalledWith("github_gh_status", { path: "D:/repo", remote: undefined });
  });
});
