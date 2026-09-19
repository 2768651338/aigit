import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { aiService } from "@/services/ai";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { BranchHealth, RepoHealth } from "@/types";
import {
  AlertCircleIcon,
  CopyIcon,
  GitBranchIcon,
  RefreshIcon,
  ScanSearchIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/common/Icons";

/**
 * Repo health panel (Branches sub-tab "health").
 *
 * One aggregated report (`get_repo_health`) drives five sections: stale
 * local branches, merged-and-deletable local branches (single + batch delete),
 * unmerged remote branches, oversized tracked files, and stash backlog.
 * An optional one-shot AI cleanup suggestion reuses the repo-chat channel
 * with a redacted, `<untrusted>`-wrapped payload (same pattern as the
 * insights report generator).
 */

interface RepoHealthPanelProps {
  /** Jump to the stash sub-tab from the backlog section. */
  onOpenStash?: () => void;
}

export function RepoHealthPanel({ onOpenStash }: RepoHealthPanelProps) {
  const { t, i18n: i18nInstance } = useTranslation();
  const { currentPath, deleteBranch, refreshBranches } = useRepoStore(
    useShallow((s) => ({
      currentPath: s.currentPath,
      deleteBranch: s.deleteBranch,
      refreshBranches: s.refreshBranches,
    })),
  );
  const toast = useToastStore();

  const [health, setHealth] = useState<RepoHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    try {
      // 阈值来自设置页；面板每次刷新都取最新配置，改完设置无需重启。
      const config = await configService.getConfig();
      const report = await gitService.getRepoHealth(currentPath, {
        staleDays: config.health.stale_days,
        largeFileMinMb: config.health.large_file_min_mb,
        largeFileTopN: config.health.large_file_top_n,
      });
      setHealth(report);
    } catch (e) {
      setError(formatError(e));
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeleteBranch = async (name: string) => {
    const confirmed = await confirmDialog(
      t("health.deleteBranchTitle"),
      t("health.deleteBranchConfirm", { name }),
      "warning",
    );
    if (!confirmed) return;
    try {
      await deleteBranch(name);
      toast.success(t("health.branchDeleted", { name }));
      await load();
    } catch (e) {
      toast.error(formatError(e), t("health.deleteFailed"));
    }
  };

  const deletable = health?.merged_local_branches.filter((b) => !b.occupied_by_worktree) ?? [];

  const handleDeleteAllMerged = async () => {
    if (!currentPath || deletable.length === 0) return;
    const confirmed = await confirmDialog(
      t("health.batchDeleteTitle"),
      [
        t("health.batchDeleteConfirm", { count: deletable.length }),
        ...deletable.map((b) => b.name),
      ].join("\n"),
      "warning",
    );
    if (!confirmed) return;
    setBatchDeleting(true);
    let ok = 0;
    const failed: string[] = [];
    // 顺序删除，单个失败不中断其余，结果汇总后一次性反馈。
    for (const branch of deletable) {
      try {
        await gitService.deleteBranch(currentPath, branch.name);
        ok += 1;
      } catch (e) {
        failed.push(`${branch.name}: ${formatError(e)}`);
      }
    }
    setBatchDeleting(false);
    if (failed.length === 0) {
      toast.success(t("health.batchDeleteDone", { ok }));
    } else {
      toast.error(
        [t("health.batchDeletePartial", { ok, failed: failed.length }), ...failed].join("\n"),
        t("health.batchDeleteTitle"),
      );
    }
    await Promise.all([load(), refreshBranches()]);
  };

  const handleSuggest = async () => {
    if (!health || !currentPath) return;
    setSuggesting(true);
    try {
      // 与洞察报告同款脱敏；分支名与时间戳之外的消息体不发送。
      const redact = (value: string) =>
        value
          .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+\b/gi, t("insights.report.redactedCredential"))
          .replace(/\b(?:password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, `$1=${t("insights.report.redacted")}`);
      const safe = {
        default_branch: health.default_branch,
        stale_branches: health.stale_branches.map(({ name, last_commit_date, occupied_by_worktree }) => ({
          name,
          last_commit_date,
          occupied_by_worktree,
        })),
        merged_local_branches: health.merged_local_branches.map(({ name, last_commit_date }) => ({
          name,
          last_commit_date,
        })),
        unmerged_remote_branches: health.unmerged_remote_branches.map(({ name, last_commit_date }) => ({
          name,
          last_commit_date,
        })),
        large_files: health.large_files.map(({ path, size_bytes }) => ({ path, size_bytes })),
        stash: health.stash,
        truncated: health.truncated,
      };
      const prompt = [
        t("health.aiPrompt"),
        `<untrusted>${JSON.stringify(safe).slice(0, 12000)}</untrusted>`,
      ].join("\n");
      const response = await aiService.repoChat([{ role: "user", content: prompt }], currentPath);
      setSuggestion(redact(response));
    } catch (e) {
      toast.error(formatError(e), t("health.aiFailed"));
    } finally {
      setSuggesting(false);
    }
  };

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("branches.openRepoHint")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <ScanSearchIcon size={16} className="text-text-secondary" />
        <span className="text-base font-semibold flex-1">{t("health.title")}</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-busy={loading}
          className="btn-ghost"
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          {loading ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3.5 bg-danger/10 text-danger text-sm rounded border border-danger/20">
            <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1 break-words whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {health && (
          <>
            {/* Overview */}
            <section className="rounded-lg border border-border bg-bg-surface p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
                <span>
                  {t("health.defaultBranch")}
                  {": "}
                  <span className="font-mono text-text-primary">
                    {health.default_branch ?? t("health.defaultBranchUnknown")}
                  </span>
                </span>
                <span>
                  {t("health.stashCount")}
                  {": "}
                  <span className="text-text-primary">{health.stash.count}</span>
                </span>
              </div>
              {health.truncated.branches && (
                <p className="mt-2 text-2xs text-text-muted">{t("health.truncatedBranches")}</p>
              )}
              {health.truncated.files && (
                <p className="mt-1 text-2xs text-text-muted">{t("health.truncatedFiles")}</p>
              )}
            </section>

            <SectionCard
              title={t("health.staleBranches")}
              count={health.stale_branches.length}
              emptyText={t("health.noStaleBranches")}
            >
              {health.stale_branches.map((b) => (
                <BranchRow
                  key={b.name}
                  branch={b}
                  relTime={formatRelative(b.last_commit_date, i18nInstance.language)}
                  deleteLabel={t("health.deleteBranch")}
                  onDelete={b.occupied_by_worktree ? undefined : () => void handleDeleteBranch(b.name)}
                />
              ))}
            </SectionCard>

            <SectionCard
              title={t("health.mergedBranches")}
              count={health.merged_local_branches.length}
              emptyText={
                health.default_branch ? t("health.noMergedBranches") : t("health.defaultBranchUnknownHint")
              }
              action={
                deletable.length > 0 && (
                  <button
                    onClick={() => void handleDeleteAllMerged()}
                    disabled={batchDeleting}
                    aria-busy={batchDeleting}
                    className="btn-ghost text-2xs px-1.5 py-0.5 text-text-muted hover:text-danger"
                  >
                    {batchDeleting ? <SpinnerIcon size={12} /> : <TrashIcon size={12} />}
                    {t("health.deleteAllMerged")}
                  </button>
                )
              }
            >
              {health.merged_local_branches.map((b) => (
                <BranchRow
                  key={b.name}
                  branch={b}
                  relTime={formatRelative(b.last_commit_date, i18nInstance.language)}
                  deleteLabel={t("health.deleteBranch")}
                  onDelete={b.occupied_by_worktree ? undefined : () => void handleDeleteBranch(b.name)}
                />
              ))}
            </SectionCard>

            <SectionCard
              title={t("health.unmergedRemoteBranches")}
              count={health.unmerged_remote_branches.length}
              emptyText={
                health.default_branch ? t("health.noUnmergedRemoteBranches") : t("health.defaultBranchUnknownHint")
              }
            >
              {health.unmerged_remote_branches.map((b) => (
                <BranchRow
                  key={b.name}
                  branch={b}
                  relTime={formatRelative(b.last_commit_date, i18nInstance.language)}
                />
              ))}
            </SectionCard>

            <SectionCard
              title={t("health.largeFiles")}
              count={health.large_files.length}
              emptyText={t("health.noLargeFiles")}
            >
              {health.large_files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover text-sm">
                  <span className="font-mono truncate flex-1" title={f.path}>
                    {f.path}
                  </span>
                  <span className="text-2xs text-text-muted shrink-0">{formatBytes(f.size_bytes)}</span>
                </div>
              ))}
            </SectionCard>

            {/* Stash backlog — actions live in the dedicated stash panel. */}
            <section className="rounded-lg border border-border bg-bg-surface p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold flex-1">{t("health.stashBacklog")}</h3>
                {onOpenStash && health.stash.count > 0 && (
                  <button onClick={onOpenStash} className="btn-ghost text-xs">
                    {t("health.openStashPanel")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {health.stash.count === 0
                  ? t("health.noStashBacklog")
                  : health.stash.oldest_date
                    ? t("health.stashBacklogSummary", {
                        count: health.stash.count,
                        oldest: formatRelative(health.stash.oldest_date, i18nInstance.language),
                      })
                    : t("health.stashCountSummary", { count: health.stash.count })}
              </p>
            </section>

            {/* AI cleanup suggestion (one-shot, repo-chat channel). */}
            <section className="rounded-lg border border-border bg-bg-surface p-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold flex-1">{t("health.aiSuggestion")}</h3>
                <button
                  onClick={() => void handleSuggest()}
                  disabled={suggesting}
                  aria-busy={suggesting}
                  className="text-xs rounded bg-accent px-2 py-1 text-white disabled:opacity-50"
                >
                  {suggesting ? <SpinnerIcon size={12} /> : null}
                  {suggesting ? t("health.aiGenerating") : t("health.aiGenerate")}
                </button>
              </div>
              {suggestion ? (
                <>
                  <pre className="whitespace-pre-wrap break-words text-sm text-text-primary font-sans bg-bg-base border border-border rounded p-3">
                    {suggestion}
                  </pre>
                  <button
                    onClick={() => void navigator.clipboard?.writeText(suggestion)}
                    className="btn-ghost text-2xs mt-2"
                    title={t("health.copySuggestion")}
                  >
                    <CopyIcon size={12} />
                    {t("health.copySuggestion")}
                  </button>
                </>
              ) : (
                <p className="text-sm text-text-muted">{t("health.aiSuggestionHint")}</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-surface p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold flex-1">
          {title}
          {count > 0 && <span className="ml-1.5 text-2xs text-text-muted">{count}</span>}
        </h3>
        {action}
      </div>
      {count === 0 ? (
        <p className="text-sm text-text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </section>
  );
}

function BranchRow({
  branch,
  relTime,
  deleteLabel,
  onDelete,
}: {
  branch: BranchHealth;
  relTime: string;
  deleteLabel?: string;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover text-sm">
      <GitBranchIcon size={12} className="text-text-muted shrink-0" />
      <span className="font-mono truncate flex-1" title={branch.last_commit_message}>
        {branch.name}
      </span>
      {branch.occupied_by_worktree && (
        <span className="text-2xs text-text-muted border border-border rounded px-1 py-0.5 shrink-0">
          {t("health.worktreeOccupied")}
        </span>
      )}
      <span className="text-2xs text-text-muted shrink-0">{relTime}</span>
      {onDelete && deleteLabel && (
        <button
          onClick={onDelete}
          className="btn-ghost text-2xs px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger"
          title={deleteLabel}
          aria-label={`${deleteLabel} ${branch.name}`}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );
}

/** Locale-aware relative time, same approach as BranchGraph. */
function formatRelative(timestamp: number, language: string): string {
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const diffMs = new Date(timestamp * 1000).getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(diffMs / 3600000);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(diffMs / 86400000);
  if (Math.abs(days) < 7) return rtf.format(days, "day");
  if (Math.abs(days) < 30) return rtf.format(Math.round(days / 7), "week");
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
  return rtf.format(Math.round(days / 365), "year");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
