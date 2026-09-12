import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { githubService } from "@/services/github";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import { openExternalUrl } from "@/utils/externalUrl";
import type { GitHubIssue } from "@/types";
import {
  AlertCircleIcon,
  CheckIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

type StateFilter = "open" | "closed" | "all";

/** GitHub Issues 面板：列表 / 筛选 / 新建（确认后发布）。 */
export function IssuesPanel({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const toast = useToastStore();
  const [issues, setIssues] = useState<GitHubIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    try {
      setIssues(await githubService.issueList(currentPath));
    } catch (e) {
      console.error(e);
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const list = issues ?? [];
    const q = keyword.trim().toLowerCase();
    return list.filter((issue) => {
      if (stateFilter !== "all" && issue.state !== stateFilter) return false;
      if (!q) return true;
      return (
        issue.title.toLowerCase().includes(q) ||
        String(issue.number).includes(q) ||
        issue.author.toLowerCase().includes(q)
      );
    });
  }, [issues, stateFilter, keyword]);

  const create = async () => {
    if (!currentPath || !title.trim()) return;
    const confirmed = await confirmDialog(
      t("issues.createTitle"),
      t("issues.createConfirm", { title: title.trim() }),
    );
    if (!confirmed) return;
    setCreating(true);
    try {
      const url = await githubService.issueCreate(currentPath, title.trim(), body.trim());
      toast.success(t("issues.created", { url }));
      setShowCreate(false);
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      toast.error(formatError(e), t("issues.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <h2 className="text-base font-semibold shrink-0">{t("issues.title")}</h2>
        <div className="flex items-center gap-1 bg-bg-elevated rounded p-1">
          {(["open", "closed", "all"] as const).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setStateFilter(state)}
              className={clsx(
                "px-2.5 py-1 text-xs rounded transition-colors",
                stateFilter === state
                  ? "bg-bg-hover text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t(`issues.state.${state}`)}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <SearchIcon
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("common.search")}
            className="input text-xs py-1.5 pl-7 w-full"
          />
        </div>
        <div className="flex-1" />
        {onBack && (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("pullRequests.back")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowCreate((v) => !v)}
          title={t("issues.newIssue")}
          aria-label={t("issues.newIssue")}
        >
          <PlusIcon size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void load()}
          disabled={loading}
          aria-busy={loading}
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          {loading ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      {showCreate && (
        <div className="border-b border-border p-4 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("issues.titlePlaceholder")}
            className="input text-sm w-full"
            maxLength={300}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("issues.bodyPlaceholder")}
            className="input text-xs w-full min-h-24 resize-y font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={creating || !title.trim()}
              onClick={() => void create()}
            >
              {creating && <SpinnerIcon size={13} />}
              {t("issues.submit")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="flex items-start gap-2 bg-danger/10 text-danger text-sm rounded border border-danger/20 px-3 py-2.5 mb-3">
            <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1 break-all">{error}</span>
          </div>
        )}
        {!error && issues && filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-text-muted">
            {t("issues.empty")}
          </div>
        )}
        <div className="space-y-1.5">
          {filtered.map((issue) => (
            <div key={issue.number} className="border border-border rounded">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => (prev === issue.number ? null : issue.number))
                }
                aria-expanded={expanded === issue.number}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover transition-colors"
              >
                <span
                  className={clsx(
                    "text-2xs px-1.5 py-0.5 rounded shrink-0",
                    issue.state === "open"
                      ? "bg-accent/15 text-accent"
                      : "bg-bg-hover text-text-muted",
                  )}
                >
                  #{issue.number}
                </span>
                <span className="text-sm text-text-primary truncate flex-1">
                  {issue.title}
                </span>
                {issue.labels.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    className="text-2xs px-1.5 py-0.5 rounded bg-bg-elevated border border-border-subtle text-text-muted shrink-0"
                  >
                    {label}
                  </span>
                ))}
                <span className="text-xs text-text-muted shrink-0 hidden sm:block">
                  {issue.author}
                </span>
              </button>
              {expanded === issue.number && (
                <div className="px-3 pb-3 pt-1 border-t border-border-subtle">
                  <p className="text-xs text-text-secondary whitespace-pre-wrap break-words max-h-60 overflow-auto">
                    {issue.body || t("issues.noBody")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => void openExternalUrl(issue.url)}
                    >
                      <ExternalLinkIcon size={12} />
                      {t("issues.openInBrowser")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => void navigator.clipboard?.writeText(issue.url)}
                    >
                      <CheckIcon size={12} />
                      {t("issues.copyUrl")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
