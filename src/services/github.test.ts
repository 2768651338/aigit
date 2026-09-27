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

  it("publishes PR inline comments with explicit confirmation and PR review source", async () => {
    await githubService.publishInlineComment("D:/repo", {
      pull_number: 42,
      report_id: "report-1",
      finding_id: "finding-1",
      confirmed: true,
      pull_review: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("github_publish_inline_comment", {
      path: "D:/repo",
      remote: undefined,
      input: {
        pull_number: 42,
        report_id: "report-1",
        finding_id: "finding-1",
        confirmed: true,
        pull_review: true,
      },
    });
  });
});
