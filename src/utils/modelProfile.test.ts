import { describe, expect, it } from "vitest";
import type { AppConfig, ModelProfile } from "@/types";
import {
  activeProfileOf,
  isModelSectionDirty,
  profileFromAi,
  providerFields,
  providerLabel,
} from "@/utils/modelProfile";

const profile = (overrides: Partial<ModelProfile> = {}): ModelProfile => ({
  id: "profile-1",
  name: "OpenAI",
  provider: "openai",
  model: "gpt-4o-mini",
  base_url: "https://api.openai.com/v1",
  temperature: 0.7,
  max_tokens: 2048,
  max_context_tokens: 131072,
  has_own_key: false,
  ...overrides,
});

function configWith(overrides: {
  profiles?: ModelProfile[];
  activeProfileId?: string | null;
  provider?: string;
}): AppConfig {
  return {
    ai: {
      active_provider: overrides.provider ?? "openai",
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
      active_profile_id: overrides.activeProfileId === undefined ? "profile-1" : overrides.activeProfileId,
      credential_status: { openai: false, claude: false, deepseek: false, embedding_openai: false },
    },
    profiles: overrides.profiles ?? [profile()],
    ui: { theme: "system", font_size: 14, show_diff_inline: true, language: "zh", remember_open_repos: true },
    prompts: { commit_message: "", code_review: "", repo_chat: "" },
    index: {
      enabled: true, never_upload_index: true, embedding_provider: "ollama",
      ollama_embedding_base_url: "http://localhost:11434", ollama_embedding_model: "nomic-embed-text",
      cloud_embedding_enabled: false, cloud_embedding_base_url: "https://api.openai.com/v1",
      cloud_embedding_model: "text-embedding-3-small", extra_excludes: [], include_untracked: true,
      max_file_bytes: 524288, max_chunks: 20000, chunk_lines: 120, chunk_overlap: 20,
      max_embedding_chars: 12000, top_k: 6, max_context_tokens: 8000,
    },
    health: { stale_days: 30, large_file_min_mb: 5, large_file_top_n: 20, max_scan_entries: 50000 },
    recent_repos: [],
    open_repos: [],
    active_repo: null,
  };
}

describe("activeProfileOf", () => {
  it("resolves the active profile by id", () => {
    const config = configWith({});
    expect(activeProfileOf(config)?.id).toBe("profile-1");
  });

  it("returns null for missing config, missing id, or dangling id", () => {
    expect(activeProfileOf(null)).toBeNull();
    expect(activeProfileOf(configWith({ activeProfileId: null }))).toBeNull();
    expect(activeProfileOf(configWith({ activeProfileId: "missing" }))).toBeNull();
  });
});

describe("providerFields", () => {
  it("reads the matching slot pair, defaulting custom fields to empty", () => {
    expect(providerFields(configWith({}).ai, "openai")).toEqual({
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(providerFields(configWith({}).ai, "custom")).toEqual({ model: "", baseUrl: "" });
    expect(providerFields(configWith({}).ai, "nonsense")).toEqual({ model: "", baseUrl: "" });
  });
});

describe("profileFromAi", () => {
  it("snapshots the effective fields into a profile", () => {
    const ai = configWith({ provider: "deepseek" }).ai;
    const snapshot = profileFromAi(ai, "", "My Relay", false);
    expect(snapshot).toMatchObject({
      id: "",
      name: "My Relay",
      provider: "deepseek",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com",
      temperature: 0.7,
      max_tokens: 2048,
      max_context_tokens: 131072,
      has_own_key: false,
    });
  });
});

describe("providerLabel", () => {
  it("labels known providers and passes unknown ids through", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("ollama")).toBe("Ollama");
    expect(providerLabel("weird")).toBe("weird");
  });
});

describe("isModelSectionDirty", () => {
  it("ignores untouched form copies", () => {
    const saved = configWith({});
    expect(isModelSectionDirty(saved, JSON.parse(JSON.stringify(saved)))).toBe(false);
  });

  it("detects edits to provider fields and generation params", () => {
    const saved = configWith({});
    const edited = JSON.parse(JSON.stringify(saved)) as AppConfig;
    edited.ai.temperature = 0.9;
    expect(isModelSectionDirty(saved, edited)).toBe(true);

    const editedModel = JSON.parse(JSON.stringify(saved)) as AppConfig;
    editedModel.ai.custom_base_url = "https://relay.example.test/v1";
    expect(isModelSectionDirty(saved, editedModel)).toBe(true);
  });
});
