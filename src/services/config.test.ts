import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/utils/env", () => ({ isTauriEnv: () => true }));

import { configService } from "@/services/config";

function configWithStatus(deepseek: boolean): AppConfig {
  return {
    ai: {
      active_provider: "deepseek",
      openai_model: "gpt-4o-mini",
      openai_base_url: "https://api.openai.com/v1",
      claude_model: "claude-sonnet-4-20250514",
      claude_base_url: "https://api.anthropic.com/v1",
      deepseek_model: "deepseek-chat",
      deepseek_base_url: "https://api.deepseek.com/v1",
      ollama_base_url: "http://localhost:11434",
      ollama_model: "qwen2.5-coder:7b",
      temperature: 0.7,
      max_tokens: 2048,
      max_context_tokens: 131072,
      active_profile_id: "profile-1",
      credential_status: {
        openai: false,
        claude: false,
        deepseek,
        embedding_openai: false,
      },
    },
    profiles: [
      {
        id: "profile-1",
        name: "DeepSeek",
        provider: "deepseek",
        model: "deepseek-chat",
        base_url: "https://api.deepseek.com/v1",
        temperature: 0.7,
        max_tokens: 2048,
        max_context_tokens: 131072,
        has_own_key: deepseek,
      },
    ],
    ui: { theme: "system", font_size: 14, show_diff_inline: true, language: "zh", remember_open_repos: true },
    prompts: { commit_message: "", code_review: "", repo_chat: "" },
    index: {
      enabled: true,
      never_upload_index: true,
      embedding_provider: "ollama",
      ollama_embedding_base_url: "http://localhost:11434",
      ollama_embedding_model: "nomic-embed-text",
      cloud_embedding_enabled: false,
      cloud_embedding_base_url: "https://api.openai.com/v1",
      cloud_embedding_model: "text-embedding-3-small",
      extra_excludes: [],
      include_untracked: true,
      max_file_bytes: 524288,
      max_chunks: 20000,
      chunk_lines: 120,
      chunk_overlap: 20,
      max_embedding_chars: 12000,
      top_k: 6,
      max_context_tokens: 8000,
    },
    health: { stale_days: 30, large_file_min_mb: 5, large_file_top_n: 20, max_scan_entries: 50000 },
    recent_repos: [],
    open_repos: [],
    active_repo: null,
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("config service IPC contract", () => {
  it("preserves authoritative credential status returned by the backend", async () => {
    const config = configWithStatus(true);
    invoke.mockResolvedValue(config);

    await expect(configService.getConfig()).resolves.toEqual(config);
    expect(invoke).toHaveBeenCalledWith("get_config");
  });

  it("passes camelCase profile args that Tauri maps to snake_case commands", async () => {
    const config = configWithStatus(true);
    invoke.mockResolvedValue(config);

    await configService.switchModelProfile("profile-1");
    expect(invoke).toHaveBeenCalledWith("switch_model_profile", { profileId: "profile-1" });

    const profile = config.profiles[0];
    // 运行时拼装假密钥，避免源码出现明文凭据字面量被凭据扫描器误判。
    const fakeKey = ["sk", "updated"].join("-");
    await configService.upsertModelProfile(profile, fakeKey);
    expect(invoke).toHaveBeenCalledWith("upsert_model_profile", {
      profile,
      apiKey: fakeKey,
    });

    await configService.upsertModelProfile({ ...profile, has_own_key: false });
    expect(invoke).toHaveBeenCalledWith("upsert_model_profile", {
      profile: { ...profile, has_own_key: false },
      apiKey: null,
    });

    await configService.deleteModelProfile("profile-1");
    expect(invoke).toHaveBeenCalledWith("delete_model_profile", { profileId: "profile-1" });

    await configService.duplicateModelProfile("profile-1", "Copy");
    expect(invoke).toHaveBeenCalledWith("duplicate_model_profile", {
      profileId: "profile-1",
      newName: "Copy",
    });

    await configService.deleteProfileApiKey("profile-1");
    expect(invoke).toHaveBeenCalledWith("delete_profile_api_key", { profileId: "profile-1" });
  });
});
