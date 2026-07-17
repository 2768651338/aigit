import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/aiStore";
import type { AppConfig, AiProviderConfig, PromptsConfig } from "@/types";
import { CheckIcon, AlertCircleIcon, CopyIcon, MailIcon } from "@/components/common/Icons";
import { PromptEditor } from "@/components/settings/PromptEditor";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "@/i18n";
import clsx from "clsx";

const AUTHOR = "田小橙";
const QQ = "2768651338";
const EMAIL = "2768651338@qq.com";
const APP_VERSION = "1.0.1";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "claude", label: "Claude (Anthropic)", needsKey: true },
  { id: "deepseek", label: "DeepSeek", needsKey: true },
  { id: "ollama", label: "Ollama (Local)", needsKey: false },
];

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const { config, loadConfig, saveConfig, error } = useSettingsStore();
  const [local, setLocal] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
    setSaved(false);
  };

  const updateUi = (partial: Partial<AppConfig["ui"]>) => {
    if (!local) return;
    setLocal({ ...local, ui: { ...local.ui, ...partial } });
    setSaved(false);
  };

  const updatePrompts = (partial: Partial<PromptsConfig>) => {
    if (!local) return;
    setLocal({ ...local, prompts: { ...local.prompts, ...partial } });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!local) return;
    await saveConfig(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (e) {
      console.warn("[aigit] Copy to clipboard failed:", e);
    }
  };

  // Live-apply language change before save for immediate feedback
  const handleLanguageChange = (lang: string) => {
    updateUi({ language: lang });
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
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
      <div className="flex items-center px-4 h-10 border-b border-border">
        <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
        <div className="flex-1" />
        {saved && (
          <span className="flex items-center gap-1 text-2xs text-success animate-fade-in">
            <CheckIcon size={12} /> {t("settings.saved")}
          </span>
        )}
        <button onClick={handleSave} className="btn-primary ml-3">
          <CheckIcon size={14} /> {t("settings.save")}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 max-w-2xl space-y-8">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-danger/10 text-danger text-sm rounded border border-danger/20">
            <AlertCircleIcon size={16} />
            {error}
          </div>
        )}

        {/* AI Provider Selection */}
        <section>
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            {t("settings.aiProvider")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => update({ active_provider: provider.id })}
                className={clsx(
                  "flex items-center justify-between px-3 py-2 rounded border text-sm transition-colors",
                  local.ai.active_provider === provider.id
                    ? "border-accent bg-accent-glow text-accent"
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
            apiKey={local.ai.openai_api_key}
            model={local.ai.openai_model}
            baseUrl={local.ai.openai_base_url}
            onApiKey={(v) => update({ openai_api_key: v })}
            onModel={(v) => update({ openai_model: v })}
            onBaseUrl={(v) => update({ openai_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "claude" && (
          <ProviderFields
            title={t("settings.claudeConfig")}
            apiKey={local.ai.claude_api_key}
            model={local.ai.claude_model}
            baseUrl={local.ai.claude_base_url}
            onApiKey={(v) => update({ claude_api_key: v })}
            onModel={(v) => update({ claude_model: v })}
            onBaseUrl={(v) => update({ claude_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "deepseek" && (
          <ProviderFields
            title={t("settings.deepseekConfig")}
            apiKey={local.ai.deepseek_api_key}
            model={local.ai.deepseek_model}
            baseUrl={local.ai.deepseek_base_url}
            onApiKey={(v) => update({ deepseek_api_key: v })}
            onModel={(v) => update({ deepseek_model: v })}
            onBaseUrl={(v) => update({ deepseek_base_url: v })}
            labels={{ apiKey: t("settings.apiKey"), model: t("settings.model"), baseUrl: t("settings.baseUrl") }}
          />
        )}

        {local.ai.active_provider === "ollama" && (
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">
              {t("settings.ollamaConfig")}
            </h3>
            <div className="space-y-3">
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
              <p className="text-2xs text-text-muted">
                {t("settings.ollamaHint")}{" "}
                <a
                  href="https://ollama.ai"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
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
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            {t("settings.genParams")}
          </h3>
          <div className="space-y-4">
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
              <div className="flex justify-between text-2xs text-text-muted mt-1">
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
          </div>
        </section>

        {/* AI Prompts */}
        <section>
          <h3 className="text-sm font-semibold text-text-primary mb-1">
            {t("settings.prompts")}
          </h3>
          <p className="text-2xs text-text-muted mb-3">
            {t("settings.promptsHint")}
          </p>
          <div className="space-y-2">
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
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            {t("settings.interface")}
          </h3>
          <div className="space-y-3">
            {/* Language selector */}
            <Field label={t("settings.language")}>
              <div className="flex gap-2">
                {SUPPORTED_LANGUAGES.map((lang: AppLanguage) => (
                  <button
                    key={lang}
                    onClick={() => handleLanguageChange(lang)}
                    className={clsx(
                      "px-3 py-1.5 rounded border text-sm transition-colors",
                      local.ui.language === lang
                        ? "border-accent bg-accent-glow text-accent"
                        : "border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                    )}
                  >
                    {t(`languages.${lang}`)}
                    {local.ui.language === lang && (
                      <CheckIcon size={12} className="inline ml-1.5" />
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={local.ui.show_diff_inline}
                onChange={(e) => updateUi({ show_diff_inline: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-sm text-text-secondary">
                {t("settings.showDiffInline")}
              </span>
            </label>
          </div>
        </section>

        {/* Recent repos */}
        {local.recent_repos.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">
              {t("settings.recentRepos")}
            </h3>
            <div className="space-y-1">
              {local.recent_repos.map((repo, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-1.5 bg-bg-elevated rounded text-xs text-text-secondary"
                >
                  <span className="truncate">{repo}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* About / Copyright */}
        <section className="mt-2 pt-6 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">
              {t("settings.about")}
            </h3>
            <span className="text-2xs text-text-muted">
              {t("settings.version")} <span className="font-mono text-accent">v{APP_VERSION}</span>
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-muted uppercase tracking-wider min-w-[64px]">
                {t("settings.author")}
              </span>
              <span className="text-text-primary font-medium">{AUTHOR}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-muted uppercase tracking-wider min-w-[64px]">
                {t("settings.contact")}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary">QQ</span>
                <span className="text-text-primary font-mono">{QQ}</span>
                <button
                  onClick={() => handleCopy(QQ, "qq")}
                  className="text-text-muted hover:text-accent transition-colors"
                  title={t("settings.copy")}
                  aria-label={t("settings.copy")}
                >
                  {copiedField === "qq" ? (
                    <CheckIcon size={12} className="text-success" />
                  ) : (
                    <CopyIcon size={12} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-muted uppercase tracking-wider min-w-[64px]">
                Email
              </span>
              <div className="flex items-center gap-2">
                <MailIcon size={12} className="text-text-muted" />
                <a
                  href={`mailto:${EMAIL}`}
                  className="text-accent hover:underline font-mono"
                >
                  {EMAIL}
                </a>
                <button
                  onClick={() => handleCopy(EMAIL, "email")}
                  className="text-text-muted hover:text-accent transition-colors"
                  title={t("settings.copy")}
                  aria-label={t("settings.copy")}
                >
                  {copiedField === "email" ? (
                    <CheckIcon size={12} className="text-success" />
                  ) : (
                    <CopyIcon size={12} />
                  )}
                </button>
              </div>
            </div>
          </div>
          <p className="mt-4 text-2xs text-text-muted">
            © {new Date().getFullYear()} {AUTHOR}. {t("settings.copyright")}.
          </p>
        </section>
      </div>
    </div>
  );
}

function ProviderFields({
  title,
  apiKey,
  model,
  baseUrl,
  onApiKey,
  onModel,
  onBaseUrl,
  labels,
}: {
  title: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  onApiKey: (v: string) => void;
  onModel: (v: string) => void;
  onBaseUrl: (v: string) => void;
  labels: { apiKey: string; model: string; baseUrl: string };
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      <div className="space-y-3">
        <Field label={labels.apiKey}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
            className="input font-mono"
            placeholder="sk-..."
            autoComplete="off"
          />
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
            type="text"
            value={baseUrl}
            onChange={(e) => onBaseUrl(e.target.value)}
            className="input font-mono"
            placeholder="https://api.example.com/v1"
          />
        </Field>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-2xs text-text-muted uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
