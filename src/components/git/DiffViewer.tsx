import { useState, useMemo, useCallback } from "react";
import type { FileDiff } from "@/types";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import {
  ChevronRightIcon,
  ChevronDownIcon,
  PlusIcon,
  MinusIcon,
  CheckIcon,
  SpinnerIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

type DiffMode = "workdir" | "staged" | "view";

interface DiffViewerProps {
  diffs: FileDiff[];
  className?: string;
  /** Controls whether line-level staging controls are shown.
   *  - "workdir": show "stage" controls (apply patch to index)
   *  - "staged": show "unstage" controls (reverse-apply patch to index)
   *  - "view": read-only (commit diffs, stash diffs, etc.)
   *  Defaults to "view" for backward compatibility.
   */
  mode?: DiffMode;
}

/**
 * Unified diff viewer with optional line-level staging.
 *
 * In `view` mode it's a read-only pretty-printer for unified diffs.
 * In `workdir` / `staged` mode, each hunk gets a "stage hunk" / "unstage hunk"
 * button and each add/delete line gets a hover checkbox. The user can check
 * a subset of lines and click "stage selected" / "unstage selected" to apply
 * a partial patch via `git apply --cached` (forward or reverse).
 *
 * The patch is constructed client-side from the diff data — no extra backend
 * round-trip needed until the actual `apply` call.
 */
export function DiffViewer({ diffs, className, mode = "view" }: DiffViewerProps) {
  const { t } = useTranslation();
  // Track which files are collapsed (by path). Default: all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Selected line indices: keyed by `${fileIdx}:${hunkIdx}:${lineIdx}`.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const interactive = mode === "workdir" || mode === "staged";

  const { applyPatchToIndex, applyPatchToIndexReverse } = useRepoStore();
  const toast = useToastStore();

  const totalAdditions = useMemo(
    () => diffs.reduce((sum, d) => sum + d.additions, 0),
    [diffs],
  );
  const totalDeletions = useMemo(
    () => diffs.reduce((sum, d) => sum + d.deletions, 0),
    [diffs],
  );

  const toggleFile = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allCollapsed = collapsed.size === diffs.length;
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(diffs.map((d) => d.path)));

  const toggleLine = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // Build a unified-diff patch for a single hunk, optionally filtered to a
  // subset of lines. See file-level doc comment for the line-classification
  // logic (unselected deletes become context, unselected adds are dropped).
  const buildHunkPatch = useCallback(
    (diff: FileDiff, hunkIdx: number, lineKeys?: Set<string>): string => {
      const hunk = diff.hunks[hunkIdx];
      const lines: string[] = [];
      let oldCount = 0;
      let newCount = 0;

      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        const key = `${diff.path}::${hunkIdx}:${i}`;
        const isSelected = !lineKeys || lineKeys.has(key);

        if (line.line_type === "context") {
          lines.push(` ${line.content}`);
          oldCount++;
          newCount++;
        } else if (line.line_type === "add") {
          if (isSelected) {
            lines.push(`+${line.content}`);
            newCount++;
          }
          // unselected add: drop entirely (not in old, not in new)
        } else if (line.line_type === "delete") {
          if (isSelected) {
            lines.push(`-${line.content}`);
            oldCount++;
          } else {
            // unselected delete: present in both old and new → context
            lines.push(` ${line.content}`);
            oldCount++;
            newCount++;
          }
        }
      }

      // Parse old/new start from the original hunk header.
      const headerMatch = hunk.header.match(
        /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      );
      const oldStart = headerMatch ? parseInt(headerMatch[1], 10) : 1;
      const newStart = headerMatch ? parseInt(headerMatch[3], 10) : 1;

      return [
        `diff --git a/${diff.path} b/${diff.path}`,
        `--- a/${diff.path}`,
        `+++ b/${diff.path}`,
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        ...lines,
      ].join("\n");
    },
    [],
  );

  const handleStageHunk = async (diff: FileDiff, hunkIdx: number) => {
    const patch = buildHunkPatch(diff, hunkIdx);
    setApplying(true);
    try {
      if (mode === "staged") {
        await applyPatchToIndexReverse(patch);
        toast.success(t("diffStage.unstageHunk"));
      } else {
        await applyPatchToIndex(patch);
        toast.success(t("diffStage.stageHunk"));
      }
    } catch (e) {
      toast.error(formatError(e), t("diffStage.stageLinesFailed"));
    } finally {
      setApplying(false);
    }
  };

  const handleStageSelected = async () => {
    if (selected.size === 0) return;
    // Group selected line keys by `${path}::${hunkIdx}` and build one patch
    // per hunk. Multiple hunks → multiple apply calls (git apply can handle
    // multi-hunk patches, but applying per-hunk gives clearer error messages).
    const byHunk = new Map<string, Set<string>>();
    for (const key of selected) {
      // key format: `${path}::${hunkIdx}:${lineIdx}`
      const sepIdx = key.lastIndexOf("::");
      const hunkKey = key.slice(0, sepIdx);
      const group = byHunk.get(hunkKey) ?? new Set<string>();
      group.add(key);
      byHunk.set(hunkKey, group);
    }

    setApplying(true);
    try {
      for (const [hunkKey, lineKeys] of byHunk) {
        const [path, hunkIdxStr] = hunkKey.split("::");
        const diff = diffs.find((d) => d.path === path);
        if (!diff) continue;
        const hunkIdx = parseInt(hunkIdxStr, 10);
        const patch = buildHunkPatch(diff, hunkIdx, lineKeys);
        if (mode === "staged") {
          await applyPatchToIndexReverse(patch);
        } else {
          await applyPatchToIndex(patch);
        }
      }
      if (mode === "staged") {
        toast.success(t("diffStage.unstageLinesSuccess"));
      } else {
        toast.success(t("diffStage.stageLinesSuccess"));
      }
      clearSelection();
    } catch (e) {
      toast.error(formatError(e), t("diffStage.stageLinesFailed"));
    } finally {
      setApplying(false);
    }
  };

  if (diffs.length === 0) {
    return (
      <div className={clsx("flex items-center justify-center text-text-muted text-sm", className)}>
        <span>{t("diff.noChanges")}</span>
      </div>
    );
  }

  const stageLabel = mode === "staged" ? t("diffStage.unstageSelection") : t("diffStage.stageSelection");
  const hunkLabel = mode === "staged" ? t("diffStage.unstageHunk") : t("diffStage.stageHunk");

  return (
    <div className={clsx("overflow-auto font-mono text-xs select-text", className)}>
      {/* Summary header — total files + additions/deletions + bulk fold controls + selection bar. */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-3 py-2 bg-bg-elevated border-b border-border">
        <span className="text-text-secondary text-xs">
          {t("diff.filesChanged", { count: diffs.length })}
        </span>
        <span className="flex gap-1.5 text-2xs">
          <span className="text-success">+{totalAdditions}</span>
          <span className="text-danger">-{totalDeletions}</span>
        </span>
        <div className="flex-1" />
        {interactive && selected.size > 0 && (
          <>
            <span className="text-2xs text-text-muted">
              {selected.size} {t("diffStage.selectLinesHint")}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-2xs text-text-muted hover:text-text-primary transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleStageSelected}
              disabled={applying}
              className="btn-primary text-2xs px-2 py-0.5"
            >
              {applying ? <SpinnerIcon size={11} /> : <CheckIcon size={11} />}
              {stageLabel}
            </button>
          </>
        )}
        {diffs.length > 1 && (
          <button
            type="button"
            onClick={allCollapsed ? expandAll : collapseAll}
            className="text-2xs text-text-muted hover:text-text-primary transition-colors"
            title={allCollapsed ? t("diff.expandAll") : t("diff.collapseAll")}
          >
            {allCollapsed ? t("diff.expandAll") : t("diff.collapseAll")}
          </button>
        )}
      </div>

      {diffs.map((diff) => {
        const isCollapsed = collapsed.has(diff.path);
        return (
          <div key={diff.path} className="mb-4">
            <button
              type="button"
              onClick={() => toggleFile(diff.path)}
              aria-label={isCollapsed ? t("diff.expand") : t("diff.collapse")}
              aria-expanded={!isCollapsed}
              className="sticky top-9 z-10 w-full flex items-center gap-2 px-3 py-1.5 bg-bg-elevated border-b border-border hover:bg-bg-hover transition-colors text-left"
            >
              {isCollapsed ? (
                <ChevronRightIcon size={14} className="shrink-0 text-text-muted" />
              ) : (
                <ChevronDownIcon size={14} className="shrink-0 text-text-muted" />
              )}
              <span className="text-text-primary font-medium truncate flex-1">
                {diff.path}
              </span>
              <span className="flex gap-1.5 text-2xs shrink-0">
                <span className="text-success">+{diff.additions}</span>
                <span className="text-danger">-{diff.deletions}</span>
              </span>
            </button>
            {!isCollapsed && (
              <div>
                {diff.hunks.map((hunk, hi) => {
                  return (
                    <div key={hi}>
                      {/* Hunk header with optional stage-hunk button. */}
                      <div className="flex items-center gap-2 px-3 py-1 diff-hunk-header text-2xs font-mono group">
                        <span className="flex-1 truncate">{hunk.header}</span>
                        {interactive && (
                          <button
                            type="button"
                            onClick={() => handleStageHunk(diff, hi)}
                            disabled={applying}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 btn-ghost text-2xs px-1.5 py-0.5 transition-opacity"
                            title={hunkLabel}
                          >
                            {mode === "staged" ? <MinusIcon size={11} /> : <PlusIcon size={11} />}
                            {hunkLabel}
                          </button>
                        )}
                      </div>
                      {hunk.lines.map((line, li) => {
                        const key = `${diff.path}::${hi}:${li}`;
                        const isSelected = selected.has(key);
                        const isSelectable =
                          interactive &&
                          (line.line_type === "add" || line.line_type === "delete");

                        return (
                          <div
                            key={li}
                            className={clsx(
                              "flex items-start px-3 py-0.5 hover:bg-bg-hover/30 group",
                              line.line_type === "add" && "diff-add",
                              line.line_type === "delete" && "diff-del",
                              line.line_type === "context" && "diff-context"
                            )}
                          >
                            {/* Checkbox column — only for add/delete lines in interactive mode. */}
                            <span className="w-4 shrink-0 select-none flex items-center justify-center">
                              {isSelectable && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleLine(key)}
                                  className="accent-accent opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                                  style={{
                                    opacity: isSelected ? 1 : undefined,
                                  }}
                                  aria-label={t("diffStage.selectLinesHint")}
                                />
                              )}
                            </span>
                            <span className="w-8 text-text-muted select-none text-right pr-2 shrink-0">
                              {line.old_line_no ?? ""}
                            </span>
                            <span className="w-8 text-text-muted select-none text-right pr-2 shrink-0">
                              {line.new_line_no ?? ""}
                            </span>
                            <span className="w-4 shrink-0 select-none">
                              {line.line_type === "add"
                                ? "+"
                                : line.line_type === "delete"
                                ? "-"
                                : " "}
                            </span>
                            <span className="whitespace-pre-wrap break-all">{line.content}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
