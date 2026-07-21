import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { useTranslation } from "react-i18next";
import { formatError } from "@/utils/error";
import type { FileStatus } from "@/types";
import { PlusIcon, MinusIcon, UndoIcon } from "@/components/common/Icons";
import { confirmDialog } from "@/utils/dialog";
import clsx from "clsx";

const STATUS_COLORS: Record<string, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-danger",
  renamed: "text-info",
  untracked: "text-text-muted",
  typechange: "text-info",
};

const STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  typechange: "T",
};

interface FileStatusListProps {
  staged: boolean;
}

export function FileStatusList({ staged }: FileStatusListProps) {
  const { t } = useTranslation();
  const { fileStatuses, selectedFile, selectFile, stageFiles, unstageFiles, discardFiles } =
    useRepoStore();
  const toast = useToastStore();
  const files = useMemoFilteredFiles(fileStatuses, staged);

  const handleToggle = (file: FileStatus) => {
    if (staged) {
      unstageFiles([file.path]);
    } else {
      stageFiles([file.path]);
    }
  };

  // Discard working-tree modifications for a single file.
  // Destructive — requires user confirmation via native dialog.
  const handleDiscard = async (file: FileStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDialog(
      t("fileList.discardTitle"),
      t("fileList.discardConfirm", { file: file.path }),
      "warning"
    );
    if (!confirmed) return;
    try {
      await discardFiles([file.path]);
      toast.success(t("fileList.discarded", { file: file.path }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("fileList.discardFailed"));
    }
  };

  if (files.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        {staged ? t("fileList.noStaged") : t("fileList.noChanges")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {files.map((file) => (
        <div
          key={`${file.path}-${file.staged}`}
          onClick={() => selectFile(file.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectFile(file.path);
            }
          }}
          role="button"
          tabIndex={0}
          className={clsx(
            "flex items-center gap-2.5 px-2.5 py-2 rounded cursor-pointer transition-colors group focus:outline-none",
            selectedFile === file.path
              ? "bg-bg-hover"
              : "hover:bg-bg-hover"
          )}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggle(file);
            }}
            aria-label={staged ? t("fileList.unstage", { file: file.path }) : t("fileList.stage", { file: file.path })}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary"
          >
            {staged ? <MinusIcon size={14} /> : <PlusIcon size={14} />}
          </button>
          <span
            className={clsx(
              "shrink-0 w-5 text-center font-mono text-sm font-semibold",
              STATUS_COLORS[file.status]
            )}
            title={file.status}
          >
            {STATUS_LABELS[file.status] ?? "?"}
          </span>
          <span className="flex-1 truncate text-sm text-text-primary">
            {file.path}
          </span>
          {/* Discard button — only for unstaged tracked modifications.
              Hidden for untracked files (git checkout won't help) and
              only shown on hover to keep the list scannable. */}
          {!staged && file.status !== "untracked" && (
            <button
              onClick={(e) => handleDiscard(file, e)}
              aria-label={t("fileList.discard")}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-danger hover:bg-danger/10 transition-all"
              title={t("fileList.discard")}
            >
              <UndoIcon size={14} />
            </button>
          )}
          {file.old_path && file.old_path !== file.path && (
            <span className="text-xs text-text-muted truncate max-w-24">
              ← {file.old_path}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function useMemoFilteredFiles(files: FileStatus[], staged: boolean) {
  return files.filter((f) => f.staged === staged);
}
