import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/aiStore";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import type { AppConfig, AiProviderConfig, CredentialProvider, PromptsConfig } from "@/types";
import { configService } from "@/services/config";
import { CheckIcon, AlertCircleIcon, SpinnerIcon } from "@/components/common/Icons";
import { PromptEditor } from "@/components/settings/PromptEditor";
import { openExternalUrl } from "@/utils/externalUrl";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "@/i18n";
import { applyTheme, type ThemeMode } from "@/utils/theme";
import clsx from "clsx";
import { Field } from "@/components/settings/Field";
import { IndexSettingsSection } from "@/components/settings/IndexSettingsSection";
import { ChatPrivacySection } from "@/components/settings/ChatPrivacySection";
import { RecentReposSection } from "@/components/settings/RecentReposSection";
import { UpdaterSection } from "@/components/settings/UpdaterSection";
import { AboutSection } from "@/components/settings/AboutSection";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "claude", label: "Claude (Anthropic)", needsKey: true },
  { id: "deepseek", label: "DeepSeek", needsKey: true },
  { id: "custom", label: "Custom (OpenAI-compatible)", needsKey: true },
  { id: "ollama", label: "Ollama (Local)", needsKey: false },
];

const THEMES: { id: ThemeMode; labelKey: string }[] = [
  { id: "light", labelKey: "settings.themeLight" },
  { id: "dark", labelKey: "settings.themeDark" },
  { id: "system", labelKey: "settings.themeSystem" },
];

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const { config, loadConfig, saveConfig, setApiKey, deleteApiKey, error } = useSettingsStore();
  const currentPath = useRepoStore((s) => s.currentPath);
  const toast = useToastStore();
  const [local, setLocal] = useState<AppConfig | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<CredentialProvider, string>>({
    openai: "",
    claude: "",
    deepseek: "",
    custom: "",
    embedding_openai: "",
  });
  const [saving, setSaving] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState("");

  useEffect(() => {
    if (!config) {
      loadConfig();
    } else {
      setLocal(config);
    }
  }, [config, loadConfig]);

  const update = (partial: Partial<AiProviderConfig>) => {
    if (!local) return;
    setLocal({ ...local, ai: { ...local.ai, ...partial } });
  };

  const updateUi = (partial: Partial<AppConfig["ui"]>) => {
    if (!local) return;
    setLocal({ ...local, ui: { ...local.ui, ...partial } });
  };

  const updatePrompts = (partial: Partial<PromptsConfig>) => {
    if (!local) return;
    setLocal({ ...local, prompts: { ...local.prompts, ...partial } });
  };

  const updateApiKey = (provider: CredentialProvider, value: string) => {
    setApiKeys((current) => ({ ...current, [provider]: value }));
  };

  const handleSave = async () => {
    if (!local || saving) return;
    setSaving(true);
    try {
      const configSaved = await saveConfig(local);
      if (!configSaved) {
        toast.error(useSettingsStore.getState().error ?? t("settings.saveFailed"), t("settings.saveFailed"));
        return;
      }

      // Disabling "remember open repos" also clears the remembered list so a
      // later re-enable doesn't resurrect stale repos from previous sessions.
      if (!local.ui.remember_open_repos) {
        try {
          await configService.setOpenRepos([], null);
        } catch {
          // Best-effort cleanup; the startup restore is skipped regardless.
        }
      }

      for (const provider of ["openai", "claude", "deepseek", "custom"] as const) {
        const apiKey = apiKeys[provider].trim();
        if (apiKey) await setApiKey(provider, apiKey);
      }
      if (embeddingKey.trim()) await setApiKey("embedding_openai", embeddingKey.trim());
      setEmbeddingKey("");
      setApiKeys({ openai: "", claude: "", deepseek: "", custom: "", embedding_openai: "" });
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(useSettingsStore.getState().error ?? String(e), t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteApiKey = async (provider: CredentialProvider) => {
    if (saving) return;
    setSaving(true);
    try {
      await deleteApiKey(provider);
      updateApiKey(provider, "");
      toast.success(t("settings.apiKeyDeleted"));
    } catch (e) {
      toast.error(useSettingsStore.getState().error ?? String(e), t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenUrl = async (url: string) => {
    try {
      if (!(await openExternalUrl(url))) throw new Error("Unsupported external URL");
    } catch (e) {
      console.warn("[aigit] external URL open failed:", e);
    }
  };

  // Live-apply language change before save for immediate feedback
  const handleLanguageChange = (lang: string) => {
    updateUi({ language: lang });
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  };

  // Live-apply theme change before save for immediate feedback
  const handleThemeChange = (theme: string) => {
    updateUi({ theme });
    applyTheme(theme as ThemeMode);
  };

  if (!local) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("settings.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-5 h-12 border-b border-border">
        <h2 className="text-base font-semibold">{t("settings.title")}</h2>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving} aria-busy={saving} className="btn-primary ml-3">
          {saving ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />} {t("settings.save")}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8 max-w-3xl space-y-10">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-danger/10 text-danger text-sm rounded border border-danger/20">
            <AlertCircleIcon size={16} />
            {error}
          </div>
        )}

        {/* AI Provider Selection */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-4">
            {t("settings.aiProvider")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => update({ active_provider: provider.id })}
                className={clsx(
                  "flex items-center justify-between px-4 py-3 rounded border text-sm transition-colors",
                  local.ai.active_provider === provider.id
                    ? "border-border-strong bg-bg-hover text-text-primary"
                    : "border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                )}
              >
                <span>{provider.label}</span>
                {local.ai.active_provider === provider.id && (
                  <CheckIcon size={14} />
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Provider-specific settings */}
        {local.ai.active_provider === "openai" && (
          <ProviderFields
            title={t("settings.openaiConfig")}
            apiKey={apiKeys.openai}
            hasApiKey={local.ai.credential_status.openai}
            model={local.ai.openai_model}
            baseUrl={local.ai.openai_base_url}
            onApiKey={(v) => updateApiKey("openai", v)}
            onDeleteApiKey={() => handleDeleteApiKey("openai")}
            onModel={(v) => update({ openai_model: v })}
            onBaseUrl={(v) => update({ openai_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "claude" && (
          <ProviderFields
            title={t("settings.claudeConfig")}
            apiKey={apiKeys.claude}
            hasApiKey={local.ai.credential_status.claude}
            model={local.ai.claude_model}
            baseUrl={local.ai.claude_base_url}
            onApiKey={(v) => updateApiKey("claude", v)}
            onDeleteApiKey={() => handleDeleteApiKey("claude")}
            onModel={(v) => update({ claude_model: v })}
            onBaseUrl={(v) => update({ claude_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "deepseek" && (
          <ProviderFields
            title={t("settings.deepseekConfig")}
            apiKey={apiKeys.deepseek}
            hasApiKey={local.ai.credential_status.deepseek}
            model={local.ai.deepseek_model}
            baseUrl={local.ai.deepseek_base_url}
            onApiKey={(v) => updateApiKey("deepseek", v)}
            onDeleteApiKey={() => handleDeleteApiKey("deepseek")}
            onModel={(v) => update({ deepseek_model: v })}
            onBaseUrl={(v) => update({ deepseek_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "custom" && (
          <ProviderFields
            title={t("settings.customConfig")}
            apiKey={apiKeys.custom}
            hasApiKey={local.ai.credential_status.custom ?? false}
            model={local.ai.custom_model ?? ""}
            baseUrl={local.ai.custom_base_url ?? ""}
            onApiKey={(v) => updateApiKey("custom", v)}
            onDeleteApiKey={() => handleDeleteApiKey("custom")}
            onModel={(v) => update({ custom_model: v })}
            onBaseUrl={(v) => update({ custom_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "ollama" && (
          <section>
            <h3 className="text-base font-semibold text-text-primary mb-4">
              {t("settings.ollamaConfig")}
            </h3>
            <div className="space-y-4">
              <Field label={t("settings.baseUrl")}>
                <input
                  type="text"
                  value={local.ai.ollama_base_url}
                  onChange={(e) => update({ ollama_base_url: e.target.value })}
                  className="input"
                  placeholder="http://localhost:11434"
                />
              </Field>
              <Field label={t("settings.model")}>
                <input
                  type="text"
                  value={local.ai.ollama_model}
                  onChange={(e) => update({ ollama_model: e.target.value })}
                  className="input font-mono"
                  placeholder="qwen2.5-coder:7b"
                />
              </Field>
              <p className="text-xs text-text-muted">
                {t("settings.ollamaHint")}{" "}
                <a
                  href="https://ollama.ai/"
                  onClick={(event) => {
                    event.preventDefault();
                    void handleOpenUrl("https://ollama.ai/");
                  }}
                  className="text-accent hover:underline"
                >
                  ollama.ai
                </a>
                {t("settings.ollamaHintEnd") && t("settings.ollamaHintEnd") !== "" ? " " + t("settings.ollamaHintEnd") : ""}
              </p>
            </div>
          </section>
        )}

        {/* Generation parameters */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-4">
            {t("settings.genParams")}
          </h3>
          <div className="space-y-5">
            <Field label={t("settings.temperature", { value: local.ai.temperature.toFixed(2) })}>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={local.ai.temperature}
                onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-xs text-text-muted mt-2">
                <span>{t("settings.precise")}</span>
                <span>{t("settings.balanced")}</span>
                <span>{t("settings.creative")}</span>
              </div>
            </Field>
            <Field label={t("settings.maxTokens", { value: local.ai.max_tokens })}>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={local.ai.max_tokens}
                onChange={(e) => update({ max_tokens: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
            <Field label={t("settings.maxContextTokens", { value: local.ai.max_context_tokens })}>
              <input
                type="range"
                min="8192"
                max="1048576"
                step="8192"
                value={local.ai.max_context_tokens}
                onChange={(e) => update({ max_context_tokens: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
              <p className="text-xs text-text-muted mt-2">
                {t("settings.maxContextHint")}
              </p>
            </Field>
          </div>
        </section>

        {/* AI Prompts */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-2">
            {t("settings.prompts")}
          </h3>
          <p className="text-xs text-text-muted mb-4">
            {t("settings.promptsHint")}
          </p>
          <div className="space-y-3">
            <PromptEditor
              labelKey="settings.promptCommit"
              value={local.prompts.commit_message}
              onChange={(v) => updatePrompts({ commit_message: v })}
              defaultKey="commit_message"
            />
            <PromptEditor
              labelKey="settings.promptReview"
              value={local.prompts.code_review}
              onChange={(v) => updatePrompts({ code_review: v })}
              defaultKey="code_review"
            />
            <PromptEditor
              labelKey="settings.promptChat"
              value={local.prompts.repo_chat}
              onChange={(v) => updatePrompts({ repo_chat: v })}
              defaultKey="repo_chat"
            />
          </div>
        </section>

        {/* UI Settings */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-4">
            {t("settings.interface")}
          </h3>
          <div className="space-y-4">
            {/* Theme selector */}
            <Field label={t("settings.theme")}>
              <div className="flex gap-2">
                {THEMES.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => handleThemeChange(th.id)}
                    className={clsx(
                      "px-4 py-2 rounded border text-sm transition-colors",
                      local.ui.theme === th.id
                        ? "border-border-strong bg-bg-hover text-text-primary"
                        : "border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                    )}
                  >
                    {t(th.labelKey)}
                    {local.ui.theme === th.id && (
                      <CheckIcon size={14} className="inline ml-1.5" />
                    )}
                  </button>
                ))}
              </div>
            </Field>

            {/* Language selector */}
            <Field label={t("settings.language")}>
              <div className="flex gap-2">
                {SUPPORTED_LANGUAGES.map((lang: AppLanguage) => (
                  <button
                    key={lang}
                    onClick={() => handleLanguageChange(lang)}
                    className={clsx(
                      "px-4 py-2 rounded border text-sm transition-colors",
                      local.ui.language === lang
                        ? "border-border-strong bg-bg-hover text-text-primary"
                        : "border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                    )}
                  >
                    {t(`languages.${lang}`)}
                    {local.ui.language === lang && (
                      <CheckIcon size={14} className="inline ml-1.5" />
                    )}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("settings.fontSize", { value: local.ui.font_size })}>
              <input
                type="range"
                min="12"
                max="18"
                step="1"
                value={local.ui.font_size}
                onChange={(e) => updateUi({ font_size: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>

            <Field label={t("settings.fontFamily")}>
              <input
                type="text"
                value={local.ui.font_family ?? ""}
                onChange={(e) => updateUi({ font_family: e.target.value })}
                placeholder={t("settings.fontFamilyPlaceholder")}
                className="input text-sm w-full font-mono"
              />
              <p className="mt-1.5 text-xs text-text-muted">
                {t("settings.fontFamilyHint")}
              </p>
            </Field>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={local.ui.show_diff_inline}
                onChange={(e) => updateUi({ show_diff_inline: e.target.checked })}
                className="accent-accent w-4 h-4"
              />
              <span className="text-sm text-text-secondary">
                {t("settings.showDiffInline")}
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={local.ui.remember_open_repos}
                onChange={(e) => updateUi({ remember_open_repos: e.target.checked })}
                className="accent-accent w-4 h-4"
              />
              <span className="text-sm text-text-secondary">
                {t("settings.rememberOpenRepos")}
              </span>
            </label>
          </div>
        </section>

        {/* Local code index */}
        <IndexSettingsSection
          local={local}
          onLocal={setLocal}
          embeddingKey={embeddingKey}
          onEmbeddingKey={setEmbeddingKey}
          currentPath={currentPath}
        />

        {/* Local chat privacy */}
        <ChatPrivacySection />

        {/* Recent repos */}
        <RecentReposSection repos={local.recent_repos} />

        {/* Updates */}
        <UpdaterSection />

        {/* About / Copyright */}
        <AboutSection />

      </div>
    </div>
  );
}

function ProviderFields({
  title,
  apiKey,
  hasApiKey,
  model,
  baseUrl,
  onApiKey,
  onDeleteApiKey,
  onModel,
  onBaseUrl,
  labels,
}: {
  title: string;
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  baseUrl: string;
  onApiKey: (v: string) => void;
  onDeleteApiKey: () => void;
  onModel: (v: string) => void;
  onBaseUrl: (v: string) => void;
  labels: { apiKey: string; model: string; baseUrl: string };
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-4">{title}</h3>
      <div className="space-y-4">
        <Field label={labels.apiKey}>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKey(e.target.value)}
              className="input font-mono flex-1"
              placeholder={hasApiKey ? t("settings.apiKeyConfigured") : "sk-..."}
              autoComplete="new-password"
            />
            {hasApiKey && (
              <button type="button" onClick={onDeleteApiKey} className="btn-secondary shrink-0">
                {t("settings.apiKeyDelete")}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {hasApiKey ? t("settings.apiKeyConfigured") : t("settings.apiKeyNotConfigured")}
          </p>
        </Field>
        <Field label={labels.model}>
          <input
            type="text"
            value={model}
            onChange={(e) => onModel(e.target.value)}
            className="input font-mono"
            placeholder="model-name"
          />
        </Field>
        <Field label={labels.baseUrl}>
          <input
            type="url"
            maxLength={2048}
            value={baseUrl}
            onChange={(e) => onBaseUrl(e.target.value)}
            className="input font-mono"
            placeholder="https://api.example.com/v1"
          />
          <p className="mt-1.5 text-xs text-text-muted">{t("settings.endpointHint")}</p>
        </Field>
      </div>
    </section>
  );
}
