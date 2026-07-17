import { create } from "zustand";
import type { AppConfig, ChatMessage } from "@/types";
import { aiService } from "@/services/ai";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";

interface SettingsState {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
  setConfig: (config: AppConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  config: null,
  loading: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true });
    try {
      const config = await configService.getConfig();
      console.log("[aigit] Config loaded:", { provider: config.ai.active_provider, hasKey: !!config.ai.openai_api_key });
      set({ config, loading: false });
    } catch (e) {
      console.error("[aigit] Config load failed:", e);
      set({ error: formatError(e), loading: false });
    }
  },

  saveConfig: async (config: AppConfig) => {
    try {
      await configService.saveConfig(config);
      console.log("[aigit] Config saved:", { provider: config.ai.active_provider, hasKey: !!config.ai.openai_api_key });
      set({ config });
    } catch (e) {
      console.error("[aigit] Config save failed:", e);
      set({ error: formatError(e) });
    }
  },

  setConfig: (config: AppConfig) => set({ config }),
}));

interface AiState {
  chatMessages: ChatMessage[];
  loading: boolean;
  error: string | null;
  lastResult: string | null;

  generateCommitMessage: (
    repoPath: string,
    config: AppConfig
  ) => Promise<string>;
  reviewCode: (
    repoPath: string,
    config: AppConfig,
    filePath?: string,
    stagedOnly?: boolean
  ) => Promise<string>;
  sendChatMessage: (
    content: string,
    repoPath: string | null,
    config: AppConfig
  ) => Promise<void>;
  clearChat: () => void;
  clearError: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  chatMessages: [],
  loading: false,
  error: null,
  lastResult: null,

  generateCommitMessage: async (repoPath, config) => {
    set({ loading: true, error: null });
    try {
      console.log("[aigit] Generating commit message for:", repoPath);
      const result = await aiService.generateCommitMessage(repoPath, config);
      console.log("[aigit] Commit message generated:", result.slice(0, 80));
      set({ lastResult: result, loading: false });
      return result;
    } catch (e) {
      console.error("[aigit] Generate commit message failed:", e);
      set({ error: formatError(e), loading: false });
      throw e;
    }
  },

  reviewCode: async (repoPath, config, filePath, stagedOnly) => {
    set({ loading: true, error: null });
    try {
      console.log("[aigit] Reviewing code:", repoPath, filePath, stagedOnly);
      const result = await aiService.reviewCode(
        repoPath,
        config,
        filePath,
        stagedOnly
      );
      set({ lastResult: result, loading: false });
      return result;
    } catch (e) {
      console.error("[aigit] Code review failed:", e);
      set({ error: formatError(e), loading: false });
      throw e;
    }
  },

  sendChatMessage: async (content, repoPath, config) => {
    const userMessage: ChatMessage = {
      role: "user",
      content,
    };
    const messages = [...get().chatMessages, userMessage];
    set({ chatMessages: messages, loading: true, error: null });

    try {
      console.log("[aigit] Sending chat message");
      const response = await aiService.repoChat(messages, config, repoPath ?? undefined);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response,
      };
      set({
        chatMessages: [...messages, assistantMessage],
        loading: false,
      });
    } catch (e) {
      console.error("[aigit] Chat failed:", e);
      set({ error: formatError(e), loading: false });
    }
  },

  clearChat: () => set({ chatMessages: [], lastResult: null }),
  clearError: () => set({ error: null }),
}));
