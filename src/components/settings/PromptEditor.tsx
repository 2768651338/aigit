import { useState } from "react";
import { useTranslation } from "react-i18next";
import { configService } from "@/services/config";
import type { DefaultPrompts } from "@/types";
import { formatError } from "@/utils/error";
import { RotateCcwIcon, ChevronDownIcon, ChevronRightIcon } from "@/components/common/Icons";
import clsx from "clsx";

interface PromptEditorProps {
  /** i18n key for the prompt title, e.g. "settings.promptCommit" */
  labelKey: string;
  /** Current custom prompt value (empty string = use default). */
  value: string;
  /** Called when the user edits the prompt. */
  onChange: (value: string) => void;
  /** Which default prompt to fetch: "commit_message" | "code_review" | "repo_chat". */
  defaultKey: keyof DefaultPrompts;
}

/**
 * Collapsible prompt editor with "reset to default" support.
 * - Shows a status badge: "Customized" or "Default".
 * - Loads the built-in default on demand for "reset" and as a placeholder.
 * - Empty value means "use built-in default".
 */
export function PromptEditor({
  labelKey,
  value,
  onChange,
  defaultKey,
}: PromptEditorProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [defaultPrompt, setDefaultPrompt] = useState<string | null>(null);
  const [loadingDefault, setLoadingDefault] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isCustomized = value.trim().length > 0;

  // Lazily fetch the built-in default prompt the first time the user expands.
  const ensureDefaultLoaded = async () => {
    if (defaultPrompt !== null || loadingDefault) return;
    setLoadingDefault(true);
    setLoadError(null);
    try {
      const defaults = await configService.getDefaultPrompts();
      setDefaultPrompt(defaults[defaultKey]);
    } catch (e) {
      setLoadError(formatError(e));
    } finally {
      setLoadingDefault(false);
    }
  };

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      await ensureDefaultLoaded();
    }
  };

  const handleReset = () => {
    onChange("");
  };

  const handleUseDefault = async () => {
    await ensureDefaultLoaded();
    if (defaultPrompt !== null) {
      onChange(defaultPrompt);
    }
  };

  return (
    <div className="rounded-md border border-border bg-bg-elevated overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={handleExpand}
          className="flex items-center gap-1.5 text-sm text-text-primary hover:text-accent transition-colors flex-1 text-left"
        >
          {expanded ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <span>{t(labelKey)}</span>
        </button>

        {/* Status badge */}
        <span
          className={clsx(
            "text-2xs px-1.5 py-0.5 rounded",
            isCustomized
              ? "bg-accent-glow text-accent"
              : "bg-bg-hover text-text-muted"
          )}
        >
          {isCustomized ? t("settings.promptCustomized") : t("settings.promptUseDefault")}
        </span>

        {/* Reset button */}
        {isCustomized && (
          <button
            onClick={handleReset}
            className="btn-ghost text-2xs"
            title={t("settings.promptReset")}
          >
            <RotateCcwIcon size={12} />
            {t("settings.promptReset")}
          </button>
        )}
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-border">
          {loadError && (
            <div className="px-3 py-2 text-2xs text-danger bg-danger/10">
              {loadError}
            </div>
          )}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              loadingDefault
                ? t("settings.promptLoadingDefault")
                : defaultPrompt ?? ""
            }
            className="w-full h-48 bg-bg-base text-xs font-mono text-text-primary placeholder:text-text-muted p-3 focus:outline-none resize-y"
            spellCheck={false}
          />
          {/* Footer with hint + use-default button */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-bg-surface">
            <span className="flex-1 text-2xs text-text-muted">
              {t("settings.promptsHint")}
            </span>
            <button
              onClick={handleUseDefault}
              disabled={loadingDefault || defaultPrompt === null}
              className="btn-ghost text-2xs"
            >
              {t("settings.promptUseDefault")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
