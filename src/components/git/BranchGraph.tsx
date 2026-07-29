import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import type { LogEntry } from "@/types";
import {
  GitBranchIcon,
  AlertCircleIcon,
  SpinnerIcon,
  XIcon,
  SearchIcon,
  FilterIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

export function BranchGraph() {
  const { t } = useTranslation();
  const { log, branches, currentPath } = useRepoStore();
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [showAuthorFilter, setShowAuthorFilter] = useState(false);

  // Unique authors from the loaded log — used to populate the author dropdown.
  const authors = useMemo(
    () => Array.from(new Set(log.map((e) => e.author))).sort(),
    [log]
  );

  const q = search.trim().toLowerCase();
  const filteredLog = log.filter((e) => {
    if (authorFilter && e.author !== authorFilter) return false;
    if (!q) return true;
    return (
      e.message.toLowerCase().includes(q) ||
      e.author.toLowerCase().includes(q) ||
      e.short_hash.toLowerCase().includes(q)
    );
  });

  const laneMap = computeLanes(filteredLog);

  const handleEntryClick = async (entry: LogEntry) => {
    if (!currentPath) return;
    // Toggle off if clicking the same entry again.
    if (selectedHash === entry.hash) {
      setSelectedHash(null);
      setSelectedEntry(null);
      setDiffText("");
      setError(null);
      return;
    }
    setSelectedHash(entry.hash);
    setSelectedEntry(entry);
    setDiffText("");
    setError(null);
    setLoading(true);
    try {
      const diff = await gitService.getCommitDiff(currentPath, entry.hash);
      setDiffText(diff);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0">
        <h2 className="text-base font-semibold shrink-0">{t("branches.history")}</h2>
        <div className="relative flex-1 max-w-sm">
          <SearchIcon
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            className="input text-xs py-1.5 pl-7 pr-7 w-full"
          />
          <button
            onClick={() => setShowAuthorFilter((v) => !v)}
            className={clsx(
              "absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors",
              showAuthorFilter && "text-accent"
            )}
            title={t("branches.filterAuthor")}
            aria-label={t("branches.filterAuthor")}
          >
            <FilterIcon size={12} />
          </button>
        </div>
        {showAuthorFilter && (
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="input text-xs py-1.5 max-w-40"
          >
            <option value="">{t("branches.filterAllAuthors")}</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
        <span className="text-2xs text-text-muted shrink-0">
          {filteredLog.length}/{log.length}
        </span>
      </div>
      <div className="flex flex-1 overflow-hidden">
      {/* Commit list */}
      <div className="flex-1 overflow-auto h-full">
        <div className="min-w-full">
          {filteredLog.map((entry, idx) => {
            const lanes = laneMap.get(entry.hash) ?? { lane: 0, maxLanes: 1 };
            const isMerge = entry.parents.length > 1;
            const localRefs = entry.refs.filter((r) => !r.includes("/"));
            const isSelected = selectedHash === entry.hash;

            return (
              <div
                key={entry.hash}
                onClick={() => handleEntryClick(entry)}
                className={clsx(
                  "flex items-center gap-3 px-4 py-2 cursor-pointer group",
                  isSelected ? "bg-bg-hover" : "hover:bg-bg-hover/50"
                )}
                style={{ minHeight: "40px" }}
              >
                {/* Graph lane */}
                <div
                  className="relative flex items-center"
                  style={{ width: `${Math.max(lanes.maxLanes + 1, 1) * 20}px` }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      left: `${lanes.lane * 20 + 6}px`,
                      width: "8px",
                      height: "8px",
                      backgroundColor: isMerge ? "rgb(var(--color-warning))" : "rgb(var(--color-accent))",
                    }}
                  />
                  {/* Vertical line for parent */}
                  {idx < filteredLog.length - 1 && (
                    <div
                      className="absolute top-1/2 w-px bg-border"
                      style={{
                        left: `${lanes.lane * 20 + 10}px`,
                        height: "100%",
                      }}
                    />
                  )}
                </div>

                {/* Refs */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {localRefs.map((ref) => (
                    <span
                      key={ref}
                      className={clsx(
                        "badge text-xs",
                        branches.find((b) => b.name === ref)?.is_current
                          ? "bg-accent text-bg-base"
                          : "bg-bg-elevated text-text-secondary border border-border"
                      )}
                    >
                      <GitBranchIcon size={11} className="mr-1" />
                      {ref}
                    </span>
                  ))}
                  {entry.refs
                    .filter((r) => r.includes("/"))
                    .map((ref) => (
                      <span
                        key={ref}
                        className="badge text-xs bg-bg-elevated text-text-muted border border-border-subtle"
                      >
                        {ref.replace("origin/", "")}
                      </span>
                    ))}
                </div>

                {/* Hash */}
                <span className="font-mono text-xs text-text-muted shrink-0">
                  {entry.short_hash}
                </span>

                {/* Message */}
                <span className="text-sm text-text-primary truncate flex-1">
                  {entry.message}
                </span>

                {/* Author */}
                <span className="text-xs text-text-muted shrink-0 hidden sm:block">
                  {entry.author}
                </span>

                {/* Date */}
                <span className="text-xs text-text-muted shrink-0">
                  {formatDate(entry.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel: commit diff (visible only when an entry is selected) */}
      {selectedEntry && (
        <div className="w-1/2 border-l border-border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
            <span className="font-mono text-xs text-text-muted">
              {selectedEntry.short_hash}
            </span>
            <span className="text-sm font-medium text-text-primary truncate flex-1">
              {selectedEntry.message.split("\n")[0]}
            </span>
            <button
              onClick={() => {
                setSelectedHash(null);
                setSelectedEntry(null);
                setDiffText("");
                setError(null);
              }}
              className="btn-ghost text-xs"
              title={t("changes.dismiss")}
              aria-label={t("changes.dismiss")}
            >
              <XIcon size={14} />
            </button>
          </div>

          {/* Meta */}
          <div className="px-4 py-2.5 border-b border-border text-xs text-text-muted shrink-0">
            {selectedEntry.author} &lt;{selectedEntry.email}&gt; ·{" "}
            {new Date(selectedEntry.timestamp * 1000).toLocaleString()}
          </div>

          {/* Diff content */}
          <div className="flex-1 overflow-auto">
            {error && (
              <div className="flex items-start gap-2 p-3.5 m-3 bg-danger/10 text-danger text-sm rounded border border-danger/20">
                <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
                <span className="flex-1 break-words whitespace-pre-wrap">{error}</span>
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
                <SpinnerIcon size={14} />
                {t("branches.loadingDiff")}
              </div>
            )}
            {!loading && !error && diffText && (
              <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre-wrap break-all leading-relaxed select-text">
                {colorizePatch(diffText)}
              </pre>
            )}
            {!loading && !error && !diffText && (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t("branches.noDiff")}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Render a unified-diff patch string with simple line-level coloring.
 * Returns an array of React nodes — one per line — so the parent <pre>
 * can lay them out without us re-implementing a full diff viewer.
 */
function colorizePatch(patch: string): React.ReactNode[] {
  return patch.split("\n").map((line, i) => {
    let className = "text-text-secondary";
    if (line.startsWith("+++") || line.startsWith("---")) {
      className = "text-text-primary font-semibold";
    } else if (line.startsWith("@@")) {
      className = "text-info";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "text-success";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "text-danger";
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      className = "text-info font-semibold";
    }
    return (
      <div key={i} className={className}>
        {line || " "}
      </div>
    );
  });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString();
}

function computeLanes(log: LogEntry[]): Map<string, { lane: number; maxLanes: number }> {
  const result = new Map<string, { lane: number; maxLanes: number }>();
  const activeLanes: (string | null)[] = [];
  let maxLanes = 0;

  for (const entry of log) {
    // Find if this commit is already in a lane (from child's parent reference)
    let lane = activeLanes.indexOf(entry.hash);
    if (lane === -1) {
      // Find first empty lane
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(entry.hash);
      } else {
        activeLanes[lane] = entry.hash;
      }
    }

    maxLanes = Math.max(maxLanes, activeLanes.length);

    result.set(entry.hash, { lane, maxLanes });

    // Clear this commit's lane
    activeLanes[lane] = null;

    // Add parents to lanes
    for (const parent of entry.parents) {
      if (!activeLanes.includes(parent)) {
        let parentLane = activeLanes.indexOf(null);
        if (parentLane === -1) {
          parentLane = activeLanes.length;
          activeLanes.push(parent);
        } else {
          activeLanes[parentLane] = parent;
        }
      }
    }
  }

  // Set maxLanes for all entries
  for (const [, val] of result) {
    val.maxLanes = maxLanes;
  }

  return result;
}
