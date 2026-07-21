import type { FileDiff } from "@/types";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

interface DiffViewerProps {
  diffs: FileDiff[];
  className?: string;
}

export function DiffViewer({ diffs, className }: DiffViewerProps) {
  const { t } = useTranslation();
  if (diffs.length === 0) {
    return (
      <div className={clsx("flex items-center justify-center text-text-muted text-sm", className)}>
        <span>{t("diff.noChanges")}</span>
      </div>
    );
  }

  return (
    <div className={clsx("overflow-auto font-mono text-xs select-text", className)}>
      {diffs.map((diff) => (
        <div key={diff.path} className="mb-4">
          <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-bg-elevated border-b border-border">
            <span className="text-text-primary font-medium">{diff.path}</span>
            <span className="flex gap-1.5 text-2xs">
              <span className="text-success">+{diff.additions}</span>
              <span className="text-danger">-{diff.deletions}</span>
            </span>
          </div>
          <div>
            {diff.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="px-3 py-1 diff-hunk-header text-2xs font-mono">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={clsx(
                      "flex px-3 py-0.5 hover:bg-bg-hover/30",
                      line.line_type === "add" && "diff-add",
                      line.line_type === "delete" && "diff-del",
                      line.line_type === "context" && "diff-context"
                    )}
                  >
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
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
