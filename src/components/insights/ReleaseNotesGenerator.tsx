import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "@/stores/toastStore";
import type { AppConfig, GhStatus, LogEntry, TagInfo } from "@/types";
import { aiService } from "@/services/ai";
import { gitService } from "@/services/git";
import { githubService } from "@/services/github";
import { exportInsights } from "@/utils/exportInsights";
import { generateReleaseNotes, type ReleaseNotesLabels } from "@/utils/insights";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import { SpinnerIcon } from "@/components/common/Icons";

/**
 * Release notes generator (Insights card).
 *
 * Picks a commit range between tags (or HEAD), builds a deterministic
 * offline draft grouped by conventional-commit type, offers one-shot AI
 * polish over the repo-chat channel, and can create a DRAFT GitHub release
 * for the selected end tag. Publishing stays a manual GitHub step.
 */

const RANGE_LIMIT = 1000;

export function ReleaseNotesGenerator({ config, repoPath }: { config: AppConfig | null; repoPath?: string }) {
  const { t } = useTranslation();
  const toast = useToastStore();
  const labels = useMemo<ReleaseNotesLabels>(
    () => ({
      featuresTitle: t("insights.releaseNotes.features"),
      fixesTitle: t("insights.releaseNotes.fixes"),
      performanceTitle: t("insights.releaseNotes.performance"),
      otherTitle: t("insights.releaseNotes.other"),
      noCommits: t("insights.releaseNotes.noCommits"),
    }),
    [t],
  );

  const [tags, setTags] = useState<TagInfo[]>([]);
  const [baseTag, setBaseTag] = useState("");
  const [headRef, setHeadRef] = useState("HEAD");
  const [commits, setCommits] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [creating, setCreating] = useState(false);

  // Newest tag first; the range start defaults to the latest release.
  const sortedTags = useMemo(() => [...tags].sort((a, b) => b.target_date - a.target_date), [tags]);

  const loadCommits = useCallback(
    async (base: string, head: string) => {
      if (!repoPath) return;
      setLoading(true);
      setError(null);
      try {
        const entries = await gitService.getLogRange(
          repoPath,
          base || undefined,
          head === "HEAD" ? undefined : head,
          RANGE_LIMIT,
        );
        setCommits(entries);
        setContent(generateReleaseNotes(entries, labels));
      } catch (e) {
        setCommits(null);
        setContent("");
        setError(formatError(e));
      } finally {
        setLoading(false);
      }
    },
    [repoPath, labels],
  );

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    void gitService
      .listTags(repoPath)
      .then((all) => {
        if (cancelled) return;
        setTags(all);
        const newest = [...all].sort((a, b) => b.target_date - a.target_date)[0];
        setBaseTag(newest ? newest.name : "");
      })
      .catch(() => setTags([]));
    void githubService
      .ghStatus(repoPath)
      .then((status) => {
        if (!cancelled) setGh(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) return;
    void loadCommits(baseTag, headRef);
  }, [repoPath, baseTag, headRef, loadCommits]);

  const truncated = commits !== null && commits.length >= RANGE_LIMIT;

  const polish = async () => {
    if (!commits || !config || polishing || !repoPath) return;
    setPolishing(true);
    try {
      // 报告生成器同款脱敏：提交主题/作者与草稿一起裁剪后进 untrusted 载荷。
      const redact = (value: string) =>
        value
          .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+\b/gi, t("insights.report.redactedCredential"))
          .replace(/\b(?:password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, `$1=${t("insights.report.redacted")}`);
      const safe = {
        base: baseTag || t("insights.releaseNotes.repoStart"),
        head: headRef,
        commit_count: commits.length,
        commits: commits.slice(0, 500).map(({ author, message }) => ({
          author: redact(author),
          message: redact(message).slice(0, 500),
        })),
        current_draft: redact(content).slice(0, 12000),
      };
      const prompt = [
        t("insights.releaseNotes.aiPrompt"),
        `<untrusted>${JSON.stringify(safe).slice(0, 12000)}</untrusted>`,
      ].join("\n");
      const response = await aiService.repoChat([{ role: "user", content: prompt }], repoPath);
      setContent(response);
    } catch (e) {
      toast.error(formatError(e), t("insights.releaseNotes.aiFailed"));
    } finally {
      setPolishing(false);
    }
  };

  const draftRelease = async () => {
    if (!repoPath || headRef === "HEAD" || !content.trim()) return;
    const confirmed = await confirmDialog(
      t("insights.releaseNotes.confirmTitle"),
      t("insights.releaseNotes.confirmBody", { tag: headRef }),
      "info",
    );
    if (!confirmed) return;
    setCreating(true);
    try {
      const url = await githubService.releaseCreate(repoPath, headRef, headRef, content);
      toast.success(url ? `${t("insights.releaseNotes.releaseCreated")}\n${url}` : t("insights.releaseNotes.releaseCreated"));
    } catch (e) {
      toast.error(formatError(e), t("insights.releaseNotes.releaseFailed"));
    } finally {
      setCreating(false);
    }
  };

  const ghHint = gh
    ? gh.installed
      ? gh.authenticated
        ? null
        : t("pullRequests.ghUnauthed")
      : t("pullRequests.ghMissing")
    : null;

  // 防呆：只允许为已存在的本地 tag 起草（终点为 HEAD 时没有 tag 可挂）。
  const canDraft = headRef !== "HEAD" && content.trim().length > 0 && !creating;

  return (
    <section className="rounded-lg border border-border bg-bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold flex-1">{t("insights.releaseNotes.title")}</h3>
        <select
          aria-label={t("insights.releaseNotes.baseLabel")}
          value={baseTag}
          onChange={(e) => setBaseTag(e.target.value)}
          className="input text-xs w-44"
        >
          <option value="">{t("insights.releaseNotes.repoStart")}</option>
          {sortedTags.map((tag) => (
            <option key={tag.name} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">→</span>
        <select
          aria-label={t("insights.releaseNotes.headLabel")}
          value={headRef}
          onChange={(e) => setHeadRef(e.target.value)}
          className="input text-xs w-44"
        >
          <option value="HEAD">{t("insights.releaseNotes.headDefault")}</option>
          {sortedTags.map((tag) => (
            <option key={tag.name} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
          <SpinnerIcon size={14} />
          {t("insights.loading")}
        </div>
      ) : commits !== null ? (
        <>
          <p className="text-xs text-text-muted mb-1">
            {t("insights.releaseNotes.commitsCount", { count: commits.length })}
            {truncated ? ` · ${t("insights.releaseNotes.truncated")}` : ""}
          </p>
          <div className="max-h-40 overflow-auto rounded border border-border bg-bg-base p-2 mb-3">
            {commits.map((c) => (
              <div key={c.hash} className="font-mono text-2xs text-text-secondary truncate">
                {c.short_hash} {c.message}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full min-h-48 bg-bg-base border border-border rounded p-3 text-sm font-mono"
        aria-label={t("insights.releaseNotes.draftTitle")}
      />

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          disabled={polishing || !config || !commits?.length}
          onClick={() => void polish()}
          className="text-xs rounded bg-accent px-2 py-1 text-white disabled:opacity-50"
        >
          {polishing ? <SpinnerIcon size={12} /> : null}
          {polishing ? t("insights.releaseNotes.polishing") : t("insights.releaseNotes.polish")}
        </button>
        <button
          type="button"
          disabled={!canDraft}
          onClick={() => void draftRelease()}
          className="text-xs rounded border border-border px-2 py-1 text-text-secondary disabled:opacity-50"
        >
          {creating ? <SpinnerIcon size={12} /> : null}
          {creating ? t("insights.releaseNotes.creating") : t("insights.releaseNotes.releaseBtn")}
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(content)} className="text-xs">
          {t("insights.report.copy")}
        </button>
        <button
          type="button"
          onClick={() => exportInsights({ format: "markdown", content, fileName: `release-notes-${headRef === "HEAD" ? "draft" : headRef}.md` })}
          className="text-xs"
        >
          {t("insights.report.exportMarkdown")}
        </button>
        <span className="flex-1" />
        {ghHint && <span className="text-2xs text-text-muted">{ghHint}</span>}
      </div>
      <p className="mt-2 text-2xs text-text-muted">{t("insights.releaseNotes.draftHint")}</p>
    </section>
  );
}
