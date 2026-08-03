import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore, useAiStore } from "@/stores/aiStore";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import type { AppConfig, AiProviderConfig, CredentialProvider, PromptsConfig, IndexStatus } from "@/types";
import { codeIndexService } from "@/services/codeIndex";
import { CheckIcon, AlertCircleIcon, CopyIcon, MailIcon, FolderIcon, SpinnerIcon, GithubIcon, TrashIcon } from "@/components/common/Icons";
import { PromptEditor } from "@/components/settings/PromptEditor";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "@/i18n";
import { applyTheme, type ThemeMode } from "@/utils/theme";
import clsx from "clsx";
import { openExternalUrl } from "@/utils/externalUrl";
import { updaterService, type AvailableUpdate } from "@/services/updater";

const AUTHOR = "田小橙";
const QQ = "2768651338";
const EMAIL = "2768651338@qq.com";
const GITHUB_REPO = "https://github.com/2768651338/aigit";
const APP_VERSION = "1.0.4";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "claude", label: "Claude (Anthropic)", needsKey: true },
  { id: "deepseek", label: "DeepSeek", needsKey: true },
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
  const openRepo = useRepoStore((s) => s.openRepo);
  const openTabs = useRepoStore((s) => s.tabOrder);
  const currentPath = useRepoStore((s) => s.currentPath);
  const toast = useToastStore();
  const localSaveEnabled = useAiStore((s) => s.localSaveEnabled);
  const setLocalSaveEnabled = useAiStore((s) => s.setLocalSaveEnabled);
  const clearAllHistory = useAiStore((s) => s.clearAllHistory);
  const [local, setLocal] = useState<AppConfig | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<CredentialProvider, string>>({
    openai: "",
    claude: "",
    deepseek: "",
    embedding_openai: "",
  });
  const [saving, setSaving] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [updaterEnabled, setUpdaterEnabled] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ downloaded: number; total?: number } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) {
      loadConfig();
    } else {
      setLocal(config);
    }
  }, [config, loadConfig]);

  useEffect(() => {
    if (!currentPath) { setIndexStatus(null); return; }
    void codeIndexService.status(currentPath).then(setIndexStatus).catch(() => setIndexStatus(null));
  }, [currentPath]);

  useEffect(() => {
    void updaterService.availability()
      .then(({ enabled }) => setUpdaterEnabled(enabled))
      .catch(() => setUpdaterEnabled(false));
  }, []);

  const handleCheckUpdate = async () => {
    if (!updaterEnabled || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    setAvailableUpdate(null);
    try {
      const result = await updaterService.check();
      setAvailableUpdate(result);
      if (!result) toast.success(t("settings.updateCurrent"));
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    setUpdateProgress({ downloaded: 0 });
    try {
      await updaterService.downloadAndInstall((downloaded, total) =>
        setUpdateProgress((current) => ({ downloaded, total: total ?? current?.total })),
      );
    } catch (e) {
      setUpdateError(String(e));
      setUpdateBusy(false);
    }
  };

  const runIndexAction = async (action: "rebuild" | "cancel" | "delete") => {
    if (!currentPath || !local || (indexBusy && action !== "cancel")) return;
    if (action === "rebuild") {
      setIndexBusy(true);
      try {
        // The backend reloads persisted settings before indexing, so save first.
        const configSaved = await saveConfig(local);
        if (!configSaved) {
          throw new Error(useSettingsStore.getState().error ?? t("settings.saveFailed"));
        }
        if (embeddingKey.trim()) {
          await setApiKey("embedding_openai", embeddingKey.trim());
          setEmbeddingKey("");
        }
        setIndexStatus((status) => status ? { ...status, phase: "scanning", stale: false, message: null } : status);
        setIndexStatus(await codeIndexService.rebuild(currentPath, false));
      } catch (e) {
        toast.error(String(e), t("settings.indexActionFailed"));
      } finally {
        setIndexBusy(false);
      }
      return;
    }
    try {
      if (action === "cancel") await codeIndexService.cancel(currentPath);
      if (action === "delete") await codeIndexService.delete(currentPath);
      setIndexStatus(await codeIndexService.status(currentPath));
    } catch (e) { toast.error(String(e), t("settings.indexActionFailed")); }
  };

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

      for (const provider of ["openai", "claude", "deepseek"] as const) {
        const apiKey = apiKeys[provider].trim();
        if (apiKey) await setApiKey(provider, apiKey);
      }
      if (embeddingKey.trim()) await setApiKey("embedding_openai", embeddingKey.trim());
      setEmbeddingKey("");
      setApiKeys({ openai: "", claude: "", deepseek: "", embedding_openai: "" });
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

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (e) {
      console.warn("[aigit] Copy to clipboard failed:", e);
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
          </div>
        </section>

        {/* Local code index */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.codeIndex")}</h3>
          <p className="text-xs text-text-muted mb-4">{t("settings.codeIndexHint")}</p>
          <div className="space-y-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={local.index.enabled} onChange={(e) => setLocal({ ...local, index: { ...local.index, enabled: e.target.checked } })} className="accent-accent w-4 h-4" />
              <span className="text-sm text-text-secondary">{t("settings.indexEnabled")}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={local.index.include_untracked} onChange={(e) => setLocal({ ...local, index: { ...local.index, include_untracked: e.target.checked } })} className="accent-accent w-4 h-4" />
              <span className="text-sm text-text-secondary">{t("settings.includeUntrackedIndex")}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={local.index.never_upload_index} onChange={(e) => setLocal({ ...local, index: { ...local.index, never_upload_index: e.target.checked } })} className="accent-accent w-4 h-4" />
              <span className="text-sm text-text-secondary">{t("settings.neverUploadIndex")}</span>
            </label>
            <Field label={t("settings.embeddingProvider")}>
              <select value={local.index.embedding_provider} onChange={(e) => setLocal({ ...local, index: { ...local.index, embedding_provider: e.target.value as "ollama" | "openai_compatible" } })} className="input">
                <option value="ollama">Ollama (local)</option><option value="openai_compatible">OpenAI-compatible (explicit)</option>
              </select>
            </Field>
            {local.index.embedding_provider === "ollama" ? <>
              <Field label={t("settings.model")}><input className="input font-mono" value={local.index.ollama_embedding_model} onChange={(e) => setLocal({ ...local, index: { ...local.index, ollama_embedding_model: e.target.value } })} /></Field>
              <Field label={t("settings.baseUrl")}><input className="input font-mono" value={local.index.ollama_embedding_base_url} onChange={(e) => setLocal({ ...local, index: { ...local.index, ollama_embedding_base_url: e.target.value } })} /></Field>
            </> : <>
              <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={local.index.cloud_embedding_enabled} onChange={(e) => setLocal({ ...local, index: { ...local.index, cloud_embedding_enabled: e.target.checked } })} className="accent-accent w-4 h-4" /><span className="text-sm text-text-secondary">{t("settings.enableCloudEmbedding")}</span></label>
              <Field label={t("settings.apiKey")}><input type="password" autoComplete="new-password" className="input font-mono" value={embeddingKey} onChange={(e) => setEmbeddingKey(e.target.value)} placeholder={local.ai.credential_status.embedding_openai ? t("settings.apiKeyConfigured") : "sk-..."} /></Field>
              <Field label={t("settings.model")}><input className="input font-mono" value={local.index.cloud_embedding_model} onChange={(e) => setLocal({ ...local, index: { ...local.index, cloud_embedding_model: e.target.value } })} /></Field>
              <Field label={t("settings.baseUrl")}><input className="input font-mono" value={local.index.cloud_embedding_base_url} onChange={(e) => setLocal({ ...local, index: { ...local.index, cloud_embedding_base_url: e.target.value } })} /></Field>
            </>}
            {indexStatus?.message && <p className={clsx("text-xs", indexStatus.stale ? "text-warning" : "text-text-muted")}>{indexStatus.message}</p>}
            <div className="flex items-center gap-2 text-xs text-text-muted"><span>{t("settings.indexStatus")}: {indexStatus?.phase ?? "idle"}{indexStatus?.stale ? ` (${t("settings.indexStale")})` : ""} · {indexStatus?.chunks ?? 0} chunks</span><div className="flex-1" /><button className="btn-secondary" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("rebuild")}>{t("settings.rebuildIndex")}</button><button className="btn-secondary" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("cancel")}>{t("settings.cancelIndex")}</button><button className="btn-secondary text-danger" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("delete")}>{t("settings.deleteIndex")}</button></div>
          </div>
        </section>

        {/* Local chat privacy */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.chatPrivacy")}</h3>
          <p className="text-xs text-text-muted mb-4">{t("settings.chatPrivacyHint")}</p>
          <label className="flex items-center gap-2.5 cursor-pointer mb-4">
            <input type="checkbox" checked={localSaveEnabled} onChange={(e) => setLocalSaveEnabled(e.target.checked)} className="accent-accent w-4 h-4" />
            <span className="text-sm text-text-secondary">{t("settings.saveChatLocally")}</span>
          </label>
          <button type="button" className="btn-secondary text-danger" onClick={() => { if (window.confirm(t("settings.clearChatConfirm"))) void clearAllHistory().then(() => toast.success(t("settings.chatCleared"))); }}>
            <TrashIcon size={14} /> {t("settings.clearChatHistory")}
          </button>
        </section>

        {/* Recent repos */}
        {local.recent_repos.length > 0 && (
          <section>
            <h3 className="text-base font-semibold text-text-primary mb-4">
              {t("settings.recentRepos")}
            </h3>
            <div className="space-y-2">
              {local.recent_repos.map((repo, idx) => {
                const isOpen = openTabs.includes(repo);
                return (
                  <button
                    key={idx}
                    onClick={() => openRepo(repo)}
                    disabled={isOpen}
                    className={clsx(
                      "w-full flex items-center gap-3 px-4 py-2.5 rounded text-sm transition-colors text-left",
                      isOpen
                        ? "bg-bg-elevated text-text-muted cursor-default"
                        : "bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    )}
                    title={isOpen ? t("settings.recentRepoAlreadyOpen") : t("settings.recentRepoOpen")}
                  >
                    <FolderIcon size={14} className="shrink-0 text-text-muted" />
                    <span className="flex-1 truncate">{repo}</span>
                    {isOpen && (
                      <span className="text-xs text-text-muted shrink-0">
                        {t("settings.recentRepoAlreadyOpen")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Updates */}
        <section>
          <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.updates")}</h3>
          <p className="text-xs text-text-muted mb-4">
            {updaterEnabled ? t("settings.updateEnabledHint") : t("settings.updateDisabledHint")}
          </p>
          {updateError && <p className="text-xs text-danger mb-3 break-words">{updateError}</p>}
          {availableUpdate && (
            <p className="text-sm text-text-secondary mb-3">
              {t("settings.updateAvailable", { version: availableUpdate.version })}
            </p>
          )}
          {updateProgress && (
            <div className="mb-3">
              <progress
                className="w-full"
                value={updateProgress.downloaded}
                max={updateProgress.total ?? Math.max(updateProgress.downloaded, 1)}
              />
              <p className="text-xs text-text-muted mt-1">
                {updateProgress.total
                  ? `${Math.min(100, Math.round(updateProgress.downloaded * 100 / updateProgress.total))}%`
                  : t("settings.updateDownloading")}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={!updaterEnabled || updateBusy} onClick={() => void handleCheckUpdate()}>
              {updateBusy && !updateProgress ? <SpinnerIcon size={14} /> : null}
              {t("settings.checkUpdate")}
            </button>
            {availableUpdate && (
              <button type="button" className="btn-primary" disabled={updateBusy} onClick={() => void handleInstallUpdate()}>
                {updateBusy ? <SpinnerIcon size={14} /> : null}
                {t("settings.installUpdate")}
              </button>
            )}
          </div>
        </section>

        {/* About / Copyright */}
        <section className="mt-2 pt-8 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-text-primary">
              {t("settings.about")}
            </h3>
            <span className="text-xs text-text-muted">
              {t("settings.version")} <span className="font-mono">v{APP_VERSION}</span>
            </span>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
                {t("settings.author")}
              </span>
              <span className="text-text-primary font-medium">{AUTHOR}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
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
                    <CheckIcon size={14} className="text-success" />
                  ) : (
                    <CopyIcon size={14} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
                Email
              </span>
              <div className="flex items-center gap-2">
                <MailIcon size={14} className="text-text-muted" />
                <a
                  href={`mailto:${EMAIL}`}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleOpenUrl(`mailto:${EMAIL}`);
                  }}
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
                    <CheckIcon size={14} className="text-success" />
                  ) : (
                    <CopyIcon size={12} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
                {t("settings.openSource")}
              </span>
              <div className="flex items-center gap-2">
                <GithubIcon size={14} className="text-text-muted" />
                <a
                  href={GITHUB_REPO}
                  onClick={(e) => {
                    e.preventDefault();
                    handleOpenUrl(GITHUB_REPO);
                  }}
                  className="text-accent hover:underline font-mono"
                >
                  {GITHUB_REPO}
                </a>
              </div>
            </div>
          </div>
          <p className="mt-5 text-xs text-text-muted">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}
