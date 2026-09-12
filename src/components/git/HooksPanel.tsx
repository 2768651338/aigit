import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { HookInfo } from "@/types";
import { RefreshIcon, SpinnerIcon } from "@/components/common/Icons";
import clsx from "clsx";

/** git hooks 管理面板：查看 / 编辑仓库 hooks 脚本（名称白名单内）。 */
export function HooksPanel({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const toast = useToastStore();
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!currentPath) return;
    try {
      setHooks(await gitService.listHooks(currentPath));
      setError(null);
    } catch (e) {
      console.error(e);
      setError(formatError(e));
    }
  }, [currentPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const openHook = async (hook: HookInfo) => {
    if (!currentPath) return;
    setSelected(hook.name);
    setLoading(true);
    try {
      setContent(await gitService.getHookContent(currentPath, hook.name));
    } catch (e) {
      toast.error(formatError(e));
      setSelected(null);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!currentPath || !selected) return;
    const confirmed = await confirmDialog(
      t("hooks.saveTitle"),
      t("hooks.saveConfirm", { name: selected }),
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await gitService.saveHookContent(currentPath, selected, content);
      toast.success(t("hooks.saved", { name: selected }));
      await load();
    } catch (e) {
      toast.error(formatError(e), t("hooks.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <h2 className="text-base font-semibold shrink-0">{t("hooks.title")}</h2>
        <span className="text-xs text-text-muted">{t("hooks.hint")}</span>
        <div className="flex-1" />
        {onBack && (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("pullRequests.back")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void load()}
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      {error && (
        <div className="m-4 text-sm text-danger break-all">{error}</div>
      )}

      <div className="flex-1 overflow-hidden flex">
        <div className="w-72 shrink-0 border-r border-border overflow-auto p-2 space-y-1">
          {hooks.map((hook) => (
            <button
              key={hook.name}
              type="button"
              onClick={() => void openHook(hook)}
              className={clsx(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded text-left text-xs transition-colors",
                selected === hook.name
                  ? "bg-bg-hover text-text-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
              )}
            >
              <span
                className={clsx(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  hook.exists ? "bg-accent" : "bg-border",
                )}
                aria-hidden
              />
              <span className="font-mono flex-1 truncate">{hook.name}</span>
              {hook.exists && (
                <span className="text-2xs text-text-muted shrink-0">
                  {t("hooks.exists")}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden p-4">
          {!selected && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {t("hooks.selectHook")}
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm text-text-primary">{selected}</span>
                {loading && <SpinnerIcon size={13} />}
                <div className="flex-1" />
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={saving || loading}
                  onClick={() => void save()}
                >
                  {saving && <SpinnerIcon size={13} />}
                  {t("hooks.save")}
                </button>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                placeholder={t("hooks.editorPlaceholder")}
                className="input flex-1 min-h-0 resize-none font-mono text-xs whitespace-pre"
                aria-label={t("hooks.title")}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
