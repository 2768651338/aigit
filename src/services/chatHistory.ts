import { invoke } from "@tauri-apps/api/core";
import type { ChatLoadResult, PersistedChatSession } from "@/types";
import { isTauriEnv } from "@/utils/env";

function ensureTauri() {
  if (!isTauriEnv()) throw new Error("Chat history is only available in the desktop app.");
}

export const chatHistoryService = {
  load: (repoPath: string) => {
    ensureTauri();
    return invoke<ChatLoadResult>("load_chat_sessions", { repoPath });
  },
  save: (session: PersistedChatSession) => {
    ensureTauri();
    return invoke<void>("save_chat_session", { session });
  },
  delete: (repoPath: string, sessionId: string) => {
    ensureTauri();
    return invoke<void>("delete_chat_session", { repoPath, sessionId });
  },
  clear: (repoPath?: string) => {
    ensureTauri();
    return invoke<void>("clear_chat_history", { repoPath: repoPath ?? null });
  },
};
