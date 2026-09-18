import type { AiProviderConfig, AppConfig, ModelProfile } from "@/types";

/** Chat providers a model profile may target (mirrors the Rust whitelist). */
export const CHAT_PROVIDERS = [
  "openai",
  "claude",
  "deepseek",
  "custom",
  "ollama",
] as const;

/** Language-neutral display labels; also used as the migrated profile name. */
export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  custom: "Custom",
  ollama: "Ollama",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** The profile currently applied to `ai`, if its id resolves. */
export function activeProfileOf(config: AppConfig | null): ModelProfile | null {
  if (!config) return null;
  const id = config.ai.active_profile_id;
  if (!id) return null;
  return config.profiles.find((profile) => profile.id === id) ?? null;
}

/** (model, baseUrl) slot pair of a provider as currently edited. */
export function providerFields(
  ai: AiProviderConfig,
  provider: string
): { model: string; baseUrl: string } {
  switch (provider) {
    case "openai":
      return { model: ai.openai_model, baseUrl: ai.openai_base_url };
    case "claude":
      return { model: ai.claude_model, baseUrl: ai.claude_base_url };
    case "deepseek":
      return { model: ai.deepseek_model, baseUrl: ai.deepseek_base_url };
    case "custom":
      return { model: ai.custom_model ?? "", baseUrl: ai.custom_base_url ?? "" };
    case "ollama":
      return { model: ai.ollama_model, baseUrl: ai.ollama_base_url };
    default:
      return { model: "", baseUrl: "" };
  }
}

/** Snapshot the effective AI fields (settings form values) into a profile. */
export function profileFromAi(
  ai: AiProviderConfig,
  id: string,
  name: string,
  hasOwnKey: boolean
): ModelProfile {
  const provider = ai.active_provider;
  const { model, baseUrl } = providerFields(ai, provider);
  return {
    id,
    name,
    provider,
    model,
    base_url: baseUrl,
    temperature: ai.temperature,
    max_tokens: ai.max_tokens,
    max_context_tokens: ai.max_context_tokens,
    has_own_key: hasOwnKey,
  };
}

const MODEL_DIRTY_KEYS = [
  "active_provider",
  "openai_model",
  "openai_base_url",
  "claude_model",
  "claude_base_url",
  "deepseek_model",
  "deepseek_base_url",
  "ollama_base_url",
  "ollama_model",
  "custom_base_url",
  "custom_model",
  "temperature",
  "max_tokens",
  "max_context_tokens",
] as const;

type ModelDirtyKey = (typeof MODEL_DIRTY_KEYS)[number];

function modelValueOf(ai: AiProviderConfig, key: ModelDirtyKey): string | number {
  const value: string | number | undefined = ai[key];
  return typeof value === "number" ? value : (value ?? "");
}

/** True when the settings form's AI section differs from the saved config. */
export function isModelSectionDirty(config: AppConfig, form: AppConfig): boolean {
  return MODEL_DIRTY_KEYS.some(
    (key) => modelValueOf(config.ai, key) !== modelValueOf(form.ai, key)
  );
}
