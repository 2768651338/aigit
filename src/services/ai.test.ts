import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, channels } = vi.hoisted(() => ({ invokeMock: vi.fn(), channels: [] as Array<{ onmessage?: (value: unknown) => void }> }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage?: (value: unknown) => void;
    constructor() { channels.push(this); }
  },
}));

import { aiService } from "@/services/ai";

beforeEach(() => {
  invokeMock.mockReset();
  channels.length = 0;
  invokeMock.mockResolvedValue("ok");
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

describe("aiService secure command contract", () => {
  it("does not send config or credentials when generating and reviewing", async () => {
    await aiService.generateCommitMessage("D:/repo");
    await aiService.reviewCode("D:/repo", "src/main.ts", true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "generate_commit_message", {
      repoPath: "D:/repo",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "review_code", {
      repoPath: "D:/repo",
      filePath: "src/main.ts",
      stagedOnly: true,
    });
  });

  it("sends only messages and optional repository context for chat", async () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const attachments = [{ kind: "file" as const, path: "src/main.ts" }];

    await aiService.repoChat(messages, "D:/repo", attachments);

    expect(invokeMock).toHaveBeenCalledWith("repo_chat", {
      messages,
      repoPath: "D:/repo",
      attachments,
    });
  });
  it("loads and updates repository-scoped structured review state", async () => {
    await aiService.loadReviewReport("D:/repo");
    await aiService.updateReviewFinding("D:/repo", "finding-1", "false_positive");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_review_report", { repoPath: "D:/repo" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "update_review_finding", {
      repoPath: "D:/repo",
      findingId: "finding-1",
      status: "false_positive",
    });
  });

  it("routes stream events by requestId and sends cancellation without credentials", async () => {
    invokeMock.mockImplementation(async (command: string, args: { requestId?: string }) => {
      if (command === "repo_chat_stream") {
        channels[0].onmessage?.({ type: "Started", requestId: args.requestId, provider: "openai" });
        channels[0].onmessage?.({ type: "Delta", requestId: "other", delta: "ignored" });
        channels[0].onmessage?.({ type: "Delta", requestId: args.requestId, delta: "hello" });
        channels[0].onmessage?.({ type: "Completed", requestId: args.requestId });
      }
      return undefined;
    });
    const events: unknown[] = [];
    const stream = aiService.streamRepoChat(
      [{ role: "user", content: "hi" }],
      "D:/repo",
      undefined,
      { onEvent: (event) => events.push(event) },
      "request-1"
    );

    await expect(stream.done).resolves.toBe("hello");
    await aiService.cancel("request-1");

    expect(events).toHaveLength(3);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "repo_chat_stream", expect.objectContaining({
      requestId: "request-1",
      messages: [{ role: "user", content: "hi" }],
      repoPath: "D:/repo",
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, "cancel_ai_request", { requestId: "request-1" });
    expect(JSON.stringify(invokeMock.mock.calls)).not.toMatch(/apiKey|credential|secret/i);
  });

});
