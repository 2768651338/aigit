import { invoke, Channel } from "@tauri-apps/api/core";
import type { ChatAttachment, ChatMessage, CommitPlan, FindingStatus, GitErrorAnalysis, ReviewReport } from "@/types";
import { isTauriEnv } from "@/utils/env";

export type AiRequestKind = "chat" | "review" | "commit";
export type AiStreamEvent =
  | { type: "Started"; requestId: string; provider: string; streaming: boolean }
  | { type: "Delta"; requestId: string; delta: string }
  | { type: "Usage"; requestId: string; inputTokens?: number | null; outputTokens?: number | null }
  | { type: "Completed"; requestId: string }
  | { type: "Cancelled"; requestId: string }
  | { type: "Failed"; requestId: string; code: string; message: string; retryable: boolean };

export interface AiStreamHandlers {
  onEvent: (event: AiStreamEvent) => void;
}

function ensureTauri(): void {
  if (!isTauriEnv()) {
    throw new Error(
      "此功能仅在 Tauri 桌面应用中可用。请在资源管理器中双击运行 aigit.exe，而不是在浏览器中访问。"
    );
  }
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function streamCommand(
  command: string,
  args: Record<string, unknown>,
  handlers: AiStreamHandlers,
  fallback: () => Promise<string>,
  requestId = createRequestId()
): Promise<string> {
  ensureTauri();
  let content = "";
  let terminal = false;
  let failure: Extract<AiStreamEvent, { type: "Failed" }> | null = null;
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = (event) => {
    if (event.requestId !== requestId) return;
    if (event.type === "Delta") content += event.delta;
    if (event.type === "Failed") failure = event;
    if (event.type === "Completed" || event.type === "Cancelled" || event.type === "Failed") {
      terminal = true;
    }
    handlers.onEvent(event);
  };
  try {
    await invoke<void>(command, { ...args, requestId, onEvent: channel });
    if (failure) throw failure;
    return content;
  } catch (error) {
    // Older backends do not know the stream command. Preserve compatibility by
    // falling back only when no stream event was delivered; provider failures
    // are sent as Failed events and must not trigger a duplicate request.
    if (terminal || content) throw error;
    const value = await fallback();
    handlers.onEvent({ type: "Started", requestId, provider: "fallback", streaming: false });
    if (value) handlers.onEvent({ type: "Delta", requestId, delta: value });
    handlers.onEvent({ type: "Completed", requestId });
    return value;
  }
}

export const aiService = {
  createRequestId,

  generateSmartCommitPlan: (repoPath: string) => {
    ensureTauri();
    return invoke<CommitPlan>("generate_smart_commit_plan", { repoPath });
  },

  analyzeGitError: (repoPath: string, errorText: string) => {
    ensureTauri();
    return invoke<GitErrorAnalysis>("analyze_git_error", { repoPath, errorText });
  },

  generateCommitMessage: (repoPath: string) => {
    ensureTauri();
    return invoke<string>("generate_commit_message", { repoPath });
  },

  generatePullRequestDraft: (repoPath: string, base: string, head: string) => {
    ensureTauri();
    return invoke<{ title: string; body: string }>("generate_pull_request_draft", {
      repoPath,
      base,
      head,
    });
  },

  streamCommitMessage: (
    repoPath: string,
    handlers: AiStreamHandlers,
    requestId = createRequestId()
  ) => ({
    requestId,
    done: streamCommand(
      "generate_commit_message_stream",
      { repoPath },
      handlers,
      () => aiService.generateCommitMessage(repoPath),
      requestId
    ),
  }),

  reviewCode: (repoPath: string, filePath?: string, stagedOnly?: boolean) => {
    ensureTauri();
    return invoke<ReviewReport>("review_code", { repoPath, filePath, stagedOnly });
  },

  streamReviewCode: (
    repoPath: string,
    filePath: string | undefined,
    stagedOnly: boolean | undefined,
    handlers: AiStreamHandlers,
    requestId = createRequestId()
  ) => ({
    requestId,
    done: streamCommand(
      "review_code_stream",
      { repoPath, filePath, stagedOnly },
      handlers,
      async () => {
        const report = await aiService.reviewCode(repoPath, filePath, stagedOnly);
        return report.raw_markdown || report.summary;
      },
      requestId
    ),
  }),

  loadReviewReport: (repoPath: string) => {
    ensureTauri();
    return invoke<ReviewReport | null>("load_review_report", { repoPath });
  },

  updateReviewFinding: (repoPath: string, findingId: string, status: FindingStatus) => {
    ensureTauri();
    return invoke<ReviewReport>("update_review_finding", { repoPath, findingId, status });
  },

  repoChat: (messages: ChatMessage[], repoPath?: string, attachments?: ChatAttachment[]) => {
    ensureTauri();
    return invoke<string>("repo_chat", { messages, repoPath, attachments });
  },

  streamRepoChat: (
    messages: ChatMessage[],
    repoPath: string | undefined,
    attachments: ChatAttachment[] | undefined,
    handlers: AiStreamHandlers,
    requestId = createRequestId()
  ) => ({
    requestId,
    done: streamCommand(
      "repo_chat_stream",
      { messages, repoPath, attachments },
      handlers,
      () => aiService.repoChat(messages, repoPath, attachments),
      requestId
    ),
  }),

  cancel: (requestId: string) => {
    ensureTauri();
    return invoke<boolean>("cancel_ai_request", { requestId });
  },
};
