import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import {
  ScanSearchIcon,
  AlertCircleIcon,
} from "@/components/common/Icons";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import clsx from "clsx";

export function ReviewView() {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const reviewCode = useAiStore((s) => s.reviewCode);
  const loading = useAiStore((s) => s.loading);
  const error = useAiStore((s) => s.error);
  const lastResult = useAiStore((s) =>
    currentPath ? s.lastResultByRepo[currentPath] ?? null : null
  );
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
      <div className="flex items-center px-5 h-12 border-b border-border">
        <h2 className="text-base font-semibold">{t("review.title")}</h2>
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-bg-elevated rounded p-1">
          <button
            onClick={() => setReviewScope("staged")}
            className={clsx(
              "px-3 py-1.5 text-xs rounded transition-colors",
              reviewScope === "staged"
                ? "bg-bg-hover text-text-primary font-medium"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {t("review.staged")}
          </button>
          <button
            onClick={() => setReviewScope("all")}
            className={clsx(
              "px-3 py-1.5 text-xs rounded transition-colors",
              reviewScope === "all"
                ? "bg-bg-hover text-text-primary font-medium"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {t("review.allChanges")}
          </button>
        </div>
        <button
          onClick={handleReview}
          disabled={loading}
          className="btn-primary ml-3"
        >
          {loading ? t("review.reviewing") : t("review.runReview")}
        </button>
      </div>

      {/* File selector */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <span className="text-xs text-text-muted">{t("review.file")}</span>
        <select
          value={reviewedFile ?? ""}
          onChange={(e) => setReviewedFile(e.target.value || undefined)}
          className="bg-bg-elevated border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-border-strong"
        >
          <option value="">{t("review.allFiles")}</option>
          {fileStatuses.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted ml-auto">
          {t("review.provider", { provider: config?.ai.active_provider ?? "" })}
        </span>
      </div>

      {/* Review result */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="flex items-center gap-2 p-4 bg-danger/10 text-danger text-sm rounded border border-danger/20 mb-4">
            <AlertCircleIcon size={16} />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-text-secondary">{t("review.analyzing")}</p>
          </div>
        )}

        {!loading && !lastResult && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ScanSearchIcon size={48} className="text-text-muted mb-4" />
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
