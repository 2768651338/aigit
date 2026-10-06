import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { useToastStore } from "@/stores/toastStore";
import { formatRelativeTime } from "@/utils/time";
import {
  AlertCircleIcon,
  GitBranchIcon,
  PlusIcon,
  RefreshIcon,
  SpinnerIcon,
} from "@/components/common/Icons";
import type { RepoDashboardItem } from "@/types";
import clsx from "clsx";

/** 每个"打开的仓库 + 最近仓库"的聚合状态总览，支持一键全部 fetch。 */
export function DashboardView() {
  const { t } = useTranslation();
  const toast = useToastStore();
  const { tabOrder, activePath, openRepo } = useRepoStore(
    useShallow((s) => ({
      tabOrder: s.tabOrder,
      activePath: s.activePath,
      openRepo: s.openRepo,
    })),
  );
  const recentRepos = useSettingsStore(
    useShallow((s) => s.config?.recent_repos ?? []),
  );

  const [items, setItems] = useState<RepoDashboardItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 一键 fetch 的进度与逐仓库结果（undefined = 未尝试）。
  const [fetchProgress, setFetchProgress] = useState<{
    running: boolean;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });
  const [fetchResults, setFetchResults] = useState<Map<string, "ok" | "fail">>(
    new Map(),
  );
  const stopRequestedRef = useRef(false);
  const runningTaskIdRef = useRef<string | null>(null);

  // 打开的仓库优先，最近的仓库去重后补在后面。
  const paths = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const path of [...tabOrder, ...recentRepos]) {
      if (path && !seen.has(path)) {
        seen.add(path);
        merged.push(path);
      }
    }
    return merged;
  }, [tabOrder, recentRepos]);
  const pathsKey = paths.join("\u0000");

  const load = useCallback(async () => {
    if (paths.length === 0) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await gitService.getReposDashboard(paths));
    } catch (e) {
      setError(formatError(e));
      setItems(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchAll = async () => {
    if (fetchProgress.running || items === null) return;
    const targets = items.filter((item) => item.valid);
    if (targets.length === 0) return;
    stopRequestedRef.current = false;
    setFetchResults(new Map());
    setFetchProgress({ running: true, done: 0, total: targets.length });

    let ok = 0;
    let fail = 0;
    for (let index = 0; index < targets.length; index++) {
      if (stopRequestedRef.current) break;
      const target = targets[index];
      const taskId = `dashboard:fetch:${Date.now()}:${index}`;
      runningTaskIdRef.current = taskId;
      try {
        await gitService.fetchTask(target.path, taskId);
        ok += 1;
        setFetchResults((prev) => new Map(prev).set(target.path, "ok"));
      } catch {
        fail += 1;
        setFetchResults((prev) => new Map(prev).set(target.path, "fail"));
      }
      setFetchProgress((prev) => ({ ...prev, done: index + 1 }));
    }
    runningTaskIdRef.current = null;
    setFetchProgress({ running: false, done: 0, total: 0 });
    if (!stopRequestedRef.current) {
      toast.success(t("dashboard.fetchSummary", { ok, fail }), t("dashboard.fetchAll"));
    } else {
      toast.info(t("dashboard.fetchStopped", { ok, fail }), t("dashboard.fetchAll"));
    }
    await load();
  };

  const stopFetchAll = () => {
    stopRequestedRef.current = true;
    const taskId = runningTaskIdRef.current;
    if (taskId) void gitService.cancelGitTask(taskId).catch(() => {});
  };

  const dirtyTotal = (item: RepoDashboardItem) =>
    item.staged_files + item.unstaged_files + item.untracked_files;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h1 className="text-sm font-semibold flex-1">{t("dashboard.title")}</h1>
        {fetchProgress.running ? (
          <>
            <span className="text-xs text-text-muted">
              {t("dashboard.fetching", {
                done: fetchProgress.done,
                total: fetchProgress.total,
              })}
            </span>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={stopFetchAll}
            >
              {t("dashboard.stop")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void fetchAll()}
              disabled={!items?.some((item) => item.valid)}
            >
              {t("dashboard.fetchAll")}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? (
                <SpinnerIcon size={14} className="animate-spin" />
              ) : (
                <RefreshIcon size={14} />
              )}
              {t("dashboard.refresh")}
            </button>
          </>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="flex items-start gap-2 p-3.5 bg-danger/10 text-danger text-sm rounded border border-danger/20 mb-4">
            <AlertCircleIcon size={16} />
            <span>{error}</span>
          </div>
        )}

        {items !== null && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-muted">
            <PlusIcon size={28} />
            <p className="text-sm">{t("dashboard.empty")}</p>
          </div>
        )}

        {items !== null && items.length > 0 && (
          <ul className="flex flex-col gap-2 max-w-4xl">
            {items.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => item.valid && void openRepo(item.path)}
                  className={clsx(
                    "w-full text-left rounded-lg border p-3 transition-colors",
                    item.valid
                      ? "border-border bg-bg-surface hover:bg-bg-hover cursor-pointer"
                      : "border-danger/30 bg-danger/5 cursor-default",
                    activePath === item.path && "ring-1 ring-accent",
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{item.name}</span>
                    {item.valid ? (
                      <>
                        {item.unborn ? (
                          <span className="badge bg-bg-hover text-text-muted">
                            {t("dashboard.unborn")}
                          </span>
                        ) : item.current_branch ? (
                          <span className="badge bg-bg-hover text-text-secondary">
                            <GitBranchIcon size={12} className="mr-1" />
                            {item.current_branch}
                          </span>
                        ) : null}
                        {item.behind > 0 && (
                          <span
                            className="text-xs text-danger"
                            title={t("dashboard.behindHint", { count: item.behind })}
                          >
                            ↓{item.behind}
                          </span>
                        )}
                        {item.ahead > 0 && (
                          <span
                            className="text-xs text-accent"
                            title={t("dashboard.aheadHint", { count: item.ahead })}
                          >
                            ↑{item.ahead}
                          </span>
                        )}
                        {item.behind === 0 && item.ahead === 0 && !item.upstream && (
                          <span className="text-xs text-text-muted">
                            {t("dashboard.noUpstream")}
                          </span>
                        )}
                        {dirtyTotal(item) > 0 && (
                          <span
                            className="text-xs text-warning"
                            title={t("dashboard.dirtyDetail", {
                              staged: item.staged_files,
                              unstaged: item.unstaged_files,
                              untracked: item.untracked_files,
                            })}
                          >
                            ● {dirtyTotal(item)} {t("dashboard.dirty")}
                          </span>
                        )}
                        {fetchResults.get(item.path) === "ok" && (
                          <span className="badge bg-success/10 text-success">
                            {t("dashboard.fetched")}
                          </span>
                        )}
                        {fetchResults.get(item.path) === "fail" && (
                          <span className="badge bg-danger/10 text-danger">
                            {t("dashboard.fetchFailed")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="badge bg-danger/10 text-danger">
                        {t("dashboard.invalid")}
                      </span>
                    )}
                    <span className="flex-1" />
                    {item.last_commit_ts !== null && (
                      <span className="text-xs text-text-muted">
                        {formatRelativeTime(item.last_commit_ts)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-text-muted truncate">
                    {item.error ?? item.head_summary ?? item.path}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
