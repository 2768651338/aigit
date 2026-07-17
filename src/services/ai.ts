import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, ChatMessage } from "@/types";
import { isTauriEnv } from "@/utils/env";

/**
 * When running outside a Tauri WebView (e.g. plain browser via `vite dev`),
 * `invoke` is unavailable. We throw a clear, user-facing error instead of
 * letting it fail silently so the UI can surface the message.
 */
function ensureTauri(): void {
  if (!isTauriEnv()) {
    throw new Error(
      "此功能仅在 Tauri 桌面应用中可用。请在资源管理器中双击运行 aigit.exe，而不是在浏览器中访问。"
    );
  }
}

export const aiService = {
  generateCommitMessage: (repoPath: string, config: AppConfig) => {
    ensureTauri();
    return invoke<string>("generate_commit_message", { repoPath, config });
  },

  reviewCode: (
    repoPath: string,
    config: AppConfig,
    filePath?: string,
    stagedOnly?: boolean
  ) => {
    ensureTauri();
    return invoke<string>("review_code", {
      repoPath,
      config,
      filePath,
      stagedOnly,
    });
  },

  repoChat: (
    messages: ChatMessage[],
    config: AppConfig,
    repoPath?: string
  ) => {
    ensureTauri();
    return invoke<string>("repo_chat", { messages, config, repoPath });
  },
};
