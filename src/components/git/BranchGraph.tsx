import { useRepoStore } from "@/stores/repoStore";
import type { LogEntry } from "@/types";
import { GitBranchIcon } from "@/components/common/Icons";
import clsx from "clsx";

export function BranchGraph() {
  const { log, branches } = useRepoStore();

  const laneMap = computeLanes(log);

  return (
    <div className="overflow-auto h-full">
      <div className="min-w-full">
        {log.map((entry, idx) => {
          const lanes = laneMap.get(entry.hash) ?? { lane: 0, maxLanes: 1 };
          const isMerge = entry.parents.length > 1;
          const localRefs = entry.refs.filter((r) => !r.includes("/"));

          return (
            <div
              key={entry.hash}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover/50 group cursor-pointer"
              style={{ minHeight: "32px" }}
            >
              {/* Graph lane */}
              <div className="relative flex items-center" style={{ width: `${Math.max(lanes.maxLanes + 1, 1) * 20}px` }}>
                <div
                  className="absolute rounded-full"
                  style={{
                    left: `${lanes.lane * 20 + 6}px`,
                    width: "8px",
                    height: "8px",
                    backgroundColor: isMerge ? "#ffa502" : "#d4ff3a",
                  }}
                />
                {/* Vertical line for parent */}
                {idx < log.length - 1 && (
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
              <div className="flex items-center gap-1 shrink-0">
                {localRefs.map((ref) => (
                  <span
                    key={ref}
                    className={clsx(
                      "badge text-2xs",
                      branches.find((b) => b.name === ref)?.is_current
                        ? "bg-accent text-bg-base"
                        : "bg-bg-elevated text-text-secondary border border-border"
                    )}
                  >
                    <GitBranchIcon size={10} className="mr-1" />
                    {ref}
                  </span>
                ))}
                {entry.refs.filter((r) => r.includes("/")).map((ref) => (
                  <span
                    key={ref}
                    className="badge text-2xs bg-bg-elevated text-text-muted border border-border-subtle"
                  >
                    {ref.replace("origin/", "")}
                  </span>
                ))}
              </div>

              {/* Hash */}
              <span className="font-mono text-2xs text-text-muted shrink-0">
                {entry.short_hash}
              </span>

              {/* Message */}
              <span className="text-xs text-text-primary truncate flex-1">
                {entry.message}
              </span>

              {/* Author */}
              <span className="text-2xs text-text-muted shrink-0 hidden sm:block">
                {entry.author}
              </span>

              {/* Date */}
              <span className="text-2xs text-text-muted shrink-0">
                {formatDate(entry.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
