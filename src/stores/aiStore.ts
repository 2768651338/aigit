import { create } from "zustand";
import i18n from "@/i18n";
import type { AppConfig, ChatMessage } from "@/types";
import { aiService } from "@/services/ai";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";
import { useToastStore } from "@/stores/toastStore";

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

/**
 * AI store with per-repo isolation for chat history and review results.
 *
 * `chatByRepo` / `lastResultByRepo` are the source of truth, keyed by
 * absolute repo path. Consumers select by `currentPath`:
 *   `const messages = useAiStore(s => path ? (s.chatByRepo[path] ?? []) : []);`
 *
 * `loading` stays global — only one AI operation runs at a time, and a single
 * loading flag in the status bar / buttons is enough to signal "AI is working".
 *
 * Errors are surfaced via the global Toaster (see `toastStore`) directly from
 * the catch blocks below, so we don't keep an `error` field that would leak
 * across views.
 */
interface AiState {
  chatByRepo: Record<string, ChatMessage[]>;
  lastResultByRepo: Record<string, string | null>;
  loading: boolean;

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
  /** Clear chat history for a specific repo. */
  clearChat: (repoPath: string) => void;
}

/** Push an AI failure into the global Toaster. Keeps catch blocks uniform. */
function toastAiError(e: unknown, titleKey: string) {
  const msg = formatError(e);
  useToastStore.getState().error(msg, i18n.t(titleKey));
}

export const useAiStore = create<AiState>((set, get) => ({
  chatByRepo: {},
  lastResultByRepo: {},
  loading: false,

  generateCommitMessage: async (repoPath, config) => {
    set({ loading: true });
    try {
      console.log("[aigit] Generating commit message for:", repoPath);
      const result = await aiService.generateCommitMessage(repoPath, config);
      console.log("[aigit] Commit message generated:", result.slice(0, 80));
      set((s) => ({
        lastResultByRepo: { ...s.lastResultByRepo, [repoPath]: result },
        loading: false,
      }));
      return result;
    } catch (e) {
      console.error("[aigit] Generate commit message failed:", e);
      set({ loading: false });
      // The CommitPanel also surfaces this inline (so the user keeps context
      // while writing the message). Throw so its own catch can do that.
      throw e;
    }
  },

  reviewCode: async (repoPath, config, filePath, stagedOnly) => {
    set({ loading: true });
    try {
      console.log("[aigit] Reviewing code:", repoPath, filePath, stagedOnly);
      const result = await aiService.reviewCode(
        repoPath,
        config,
        filePath,
        stagedOnly
      );
      set((s) => ({
        lastResultByRepo: { ...s.lastResultByRepo, [repoPath]: result },
        loading: false,
      }));
      useToastStore.getState().success(i18n.t("review.reviewDone"));
      return result;
    } catch (e) {
      console.error("[aigit] Code review failed:", e);
      set({ loading: false });
      toastAiError(e, "review.reviewFailed");
      throw e;
    }
  },

  sendChatMessage: async (content, repoPath, config) => {
    if (!repoPath) return;
    const userMessage: ChatMessage = { role: "user", content };
    const prior = get().chatByRepo[repoPath] ?? [];
    const messages = [...prior, userMessage];
    set((s) => ({
      chatByRepo: { ...s.chatByRepo, [repoPath]: messages },
      loading: true,
    }));

    try {
      console.log("[aigit] Sending chat message");
      const response = await aiService.repoChat(messages, config, repoPath);
      const assistantMessage: ChatMessage = { role: "assistant", content: response };
      set((s) => ({
        chatByRepo: {
          ...s.chatByRepo,
          [repoPath]: [...messages, assistantMessage],
        },
        loading: false,
      }));
    } catch (e) {
      console.error("[aigit] Chat failed:", e);
      set({ loading: false });
      toastAiError(e, "chat.errorTitle");
    }
  },

  clearChat: (repoPath: string) =>
    set((s) => ({
      chatByRepo: { ...s.chatByRepo, [repoPath]: [] },
      lastResultByRepo: { ...s.lastResultByRepo, [repoPath]: null },
    })),
}));
