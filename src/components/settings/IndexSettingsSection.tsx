import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig, IndexStatus } from "@/types";
import { codeIndexService } from "@/services/codeIndex";
import { useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { Field } from "@/components/settings/Field";
import clsx from "clsx";

interface IndexSettingsSectionProps {
  local: AppConfig;
  /** Replace the whole local draft config (same contract as the parent's setLocal). */
  onLocal: (next: AppConfig) => void;
  embeddingKey: string;
  onEmbeddingKey: (value: string) => void;
  currentPath: string | null;
}

/**
 * "Local code index" settings section. Owns the per-repo index status query
 * and the rebuild/cancel/delete actions; config edits are delegated to the
 * parent via `onLocal` so the single save button keeps working.
 */
export function IndexSettingsSection({
  local,
  onLocal,
  embeddingKey,
  onEmbeddingKey,
  currentPath,
}: IndexSettingsSectionProps) {
  const { t } = useTranslation();
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const toast = useToastStore();
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);

  useEffect(() => {
    if (!currentPath) { setIndexStatus(null); return; }
    void codeIndexService.status(currentPath).then(setIndexStatus).catch(() => setIndexStatus(null));
  }, [currentPath]);

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
          onEmbeddingKey("");
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

  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.codeIndex")}</h3>
      <p className="text-xs text-text-muted mb-4">{t("settings.codeIndexHint")}</p>
      <div className="space-y-4">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={local.index.enabled} onChange={(e) => onLocal({ ...local, index: { ...local.index, enabled: e.target.checked } })} className="accent-accent w-4 h-4" />
          <span className="text-sm text-text-secondary">{t("settings.indexEnabled")}</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={local.index.include_untracked} onChange={(e) => onLocal({ ...local, index: { ...local.index, include_untracked: e.target.checked } })} className="accent-accent w-4 h-4" />
          <span className="text-sm text-text-secondary">{t("settings.includeUntrackedIndex")}</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={local.index.never_upload_index} onChange={(e) => onLocal({ ...local, index: { ...local.index, never_upload_index: e.target.checked } })} className="accent-accent w-4 h-4" />
          <span className="text-sm text-text-secondary">{t("settings.neverUploadIndex")}</span>
        </label>
        <Field label={t("settings.embeddingProvider")}>
          <select value={local.index.embedding_provider} onChange={(e) => onLocal({ ...local, index: { ...local.index, embedding_provider: e.target.value as "ollama" | "openai_compatible" } })} className="input">
            <option value="ollama">Ollama (local)</option><option value="openai_compatible">OpenAI-compatible (explicit)</option>
          </select>
        </Field>
        {local.index.embedding_provider === "ollama" ? <>
          <Field label={t("settings.model")}><input className="input font-mono" value={local.index.ollama_embedding_model} onChange={(e) => onLocal({ ...local, index: { ...local.index, ollama_embedding_model: e.target.value } })} /></Field>
          <Field label={t("settings.baseUrl")}><input className="input font-mono" value={local.index.ollama_embedding_base_url} onChange={(e) => onLocal({ ...local, index: { ...local.index, ollama_embedding_base_url: e.target.value } })} /></Field>
        </> : <>
          <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={local.index.cloud_embedding_enabled} onChange={(e) => onLocal({ ...local, index: { ...local.index, cloud_embedding_enabled: e.target.checked } })} className="accent-accent w-4 h-4" /><span className="text-sm text-text-secondary">{t("settings.enableCloudEmbedding")}</span></label>
          <Field label={t("settings.apiKey")}><input type="password" autoComplete="new-password" className="input font-mono" value={embeddingKey} onChange={(e) => onEmbeddingKey(e.target.value)} placeholder={local.ai.credential_status.embedding_openai ? t("settings.apiKeyConfigured") : "sk-..."} /></Field>
          <Field label={t("settings.model")}><input className="input font-mono" value={local.index.cloud_embedding_model} onChange={(e) => onLocal({ ...local, index: { ...local.index, cloud_embedding_model: e.target.value } })} /></Field>
          <Field label={t("settings.baseUrl")}><input className="input font-mono" value={local.index.cloud_embedding_base_url} onChange={(e) => onLocal({ ...local, index: { ...local.index, cloud_embedding_base_url: e.target.value } })} /></Field>
        </>}
        {indexStatus?.message && <p className={clsx("text-xs", indexStatus.stale ? "text-warning" : "text-text-muted")}>{indexStatus.message}</p>}
        <div className="flex items-center gap-2 text-xs text-text-muted"><span>{t("settings.indexStatus")}: {indexStatus?.phase ?? "idle"}{indexStatus?.stale ? ` (${t("settings.indexStale")})` : ""} · {indexStatus?.chunks ?? 0} chunks</span><div className="flex-1" /><button className="btn-secondary" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("rebuild")}>{t("settings.rebuildIndex")}</button><button className="btn-secondary" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("cancel")}>{t("settings.cancelIndex")}</button><button className="btn-secondary text-danger" disabled={!currentPath || indexBusy} onClick={() => void runIndexAction("delete")}>{t("settings.deleteIndex")}</button></div>
      </div>
    </section>
  );
}
