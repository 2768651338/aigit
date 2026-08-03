import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/types";

const { getConfig, saveConfig, setApiKey, deleteApiKey } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock("@/services/config", () => ({
  configService: {
    getConfig,
    saveConfig,
    setApiKey,
    deleteApiKey,
  },
}));

vi.mock("@/services/ai", () => ({
  aiService: {
    generateCommitMessage: vi.fn(),
    reviewCode: vi.fn(),
    repoChat: vi.fn(),
  },
}));

import { buildContext, estimateTokens, isSensitivePath, useSettingsStore } from "@/stores/aiStore";

const config: AppConfig = {
  ai: {
    active_provider: "openai",
    openai_model: "gpt-4o-mini",
    openai_base_url: "https://api.openai.com/v1",
    claude_model: "claude-3-5-sonnet",
    claude_base_url: "https://api.anthropic.com",
    deepseek_model: "deepseek-chat",
    deepseek_base_url: "https://api.deepseek.com",
    ollama_base_url: "http://localhost:11434",
    ollama_model: "qwen2.5-coder:7b",
    temperature: 0.7,
    max_tokens: 2048,
    max_context_tokens: 131072,
    credential_status: { openai: false, claude: false, deepseek: false, embedding_openai: false },
  },
  ui: { theme: "system", font_size: 14, show_diff_inline: true, language: "zh" },
  prompts: { commit_message: "", code_review: "", repo_chat: "" },
  index: {
    enabled: true, never_upload_index: true, embedding_provider: "ollama",
    ollama_embedding_base_url: "http://localhost:11434", ollama_embedding_model: "nomic-embed-text",
    cloud_embedding_enabled: false, cloud_embedding_base_url: "https://api.openai.com/v1", cloud_embedding_model: "text-embedding-3-small",
    extra_excludes: ["*.map"], include_untracked: true, max_file_bytes: 524288, max_chunks: 20000,
    chunk_lines: 120, chunk_overlap: 20, max_embedding_chars: 12000, top_k: 6, max_context_tokens: 8000,
  },
  recent_repos: [],
  open_repos: [],
  active_repo: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ config: null, loading: false, error: "old error" });
});

describe("settings store secure configuration", () => {
  it("clears an old error after a successful ordinary config save", async () => {
    saveConfig.mockResolvedValue(config);

    await expect(useSettingsStore.getState().saveConfig(config)).resolves.toBe(true);

    expect(useSettingsStore.getState()).toMatchObject({ config, error: null });
  });

  it("updates credential status without retaining the plaintext key", async () => {
    const saved = {
      ...config,
      ai: { ...config.ai, credential_status: { ...config.ai.credential_status, openai: true } },
    };
    setApiKey.mockResolvedValue(saved);

    await useSettingsStore.getState().setApiKey("openai", "temporary-secret");

    expect(setApiKey).toHaveBeenCalledWith("openai", "temporary-secret");
    expect(useSettingsStore.getState()).toMatchObject({ config: saved, error: null });
    expect(JSON.stringify(useSettingsStore.getState().config)).not.toContain("temporary-secret");
  });
});

describe("chat context controls", () => {
  it("estimates CJK text more conservatively than ASCII text", () => {
    expect(estimateTokens("测试测试")).toBeGreaterThan(estimateTokens("test"));
  });

  it("summarizes old messages while retaining recent context", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: `${index}-${"x".repeat(400)}`,
    }));
    const result = buildContext(messages, 500);
    expect(result.summarized).toBe(true);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[result.messages.length - 1]?.content).toBe(messages[messages.length - 1]?.content);
  });

  it("detects environment files, private keys, and certificates", () => {
    expect(isSensitivePath("config/.env.production")).toBe(true);
    expect(isSensitivePath("certs/client.pem")).toBe(true);
    expect(isSensitivePath("src/main.ts")).toBe(false);
  });
});
