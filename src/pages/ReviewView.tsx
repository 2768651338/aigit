import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import {
  ScanSearchIcon,
  SparklesIcon,
  AlertCircleIcon,
} from "@/components/common/Icons";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import clsx from "clsx";

export function ReviewView() {
  const { t } = useTranslation();
  const { currentPath, fileStatuses } = useRepoStore();
  const { reviewCode, lastResult, loading, error } = useAiStore();
  const { config } = useSettingsStore();

  const [reviewScope, setReviewScope] = useState<"all" | "staged">("staged");
  const [reviewedFile, setReviewedFile] = useState<string | undefined>(undefined);

  const handleReview = async () => {
    if (!currentPath || !config) return;
    try {
      await reviewCode(
        currentPath,
        config,
        reviewedFile,
        reviewScope === "staged"
      );
    } catch (e) {
      console.error(e);
    }
  };

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("review.openRepoHint")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-4 h-10 border-b border-border">
        <ScanSearchIcon size={16} className="text-accent mr-2" />
        <h2 className="text-sm font-semibold">{t("review.title")}</h2>
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-bg-elevated rounded p-0.5">
          <button
            onClick={() => setReviewScope("staged")}
            className={clsx(
              "px-2 py-1 text-2xs rounded transition-colors",
              reviewScope === "staged"
                ? "bg-accent text-bg-base font-medium"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {t("review.staged")}
          </button>
          <button
            onClick={() => setReviewScope("all")}
            className={clsx(
              "px-2 py-1 text-2xs rounded transition-colors",
              reviewScope === "all"
                ? "bg-accent text-bg-base font-medium"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {t("review.allChanges")}
          </button>
        </div>
        <button
          onClick={handleReview}
          disabled={loading}
          className="btn-primary ml-2"
        >
          <SparklesIcon size={14} />
          {loading ? t("review.reviewing") : t("review.runReview")}
        </button>
      </div>

      {/* File selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <span className="text-2xs text-text-muted">{t("review.file")}</span>
        <select
          value={reviewedFile ?? ""}
          onChange={(e) => setReviewedFile(e.target.value || undefined)}
          className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="">{t("review.allFiles")}</option>
          {fileStatuses.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <span className="text-2xs text-text-muted ml-auto">
          {t("review.provider", { provider: config?.ai.active_provider ?? "" })}
        </span>
      </div>

      {/* Review result */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-danger/10 text-danger text-sm rounded border border-danger/20 mb-4">
            <AlertCircleIcon size={16} />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
            <p className="text-sm text-text-secondary">{t("review.analyzing")}</p>
          </div>
        )}

        {!loading && !lastResult && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ScanSearchIcon size={48} className="text-text-muted mb-3" />
            <p className="text-sm text-text-secondary max-w-md">
              {t("review.emptyHint")}
            </p>
          </div>
        )}

        {!loading && lastResult && (
          <div className="prose prose-invert max-w-none">
            <div className="text-sm leading-relaxed">
              <MarkdownRenderer content={lastResult} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
