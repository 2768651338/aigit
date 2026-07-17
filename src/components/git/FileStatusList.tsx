import { useRepoStore } from "@/stores/repoStore";
import { useTranslation } from "react-i18next";
import type { FileStatus } from "@/types";
import { PlusIcon, MinusIcon } from "@/components/common/Icons";
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
  const { fileStatuses, selectedFile, selectFile, stageFiles, unstageFiles } =
    useRepoStore();
  const files = useMemoFilteredFiles(fileStatuses, staged);

  const handleToggle = (file: FileStatus) => {
    if (staged) {
      unstageFiles([file.path]);
    } else {
      stageFiles([file.path]);
    }
  };

  if (files.length === 0) {
    return (
      <div className="text-center text-text-muted text-xs py-4">
        {staged ? t("fileList.noStaged") : t("fileList.noChanges")}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {files.map((file) => (
        <div
          key={`${file.path}-${file.staged}`}
          onClick={() => selectFile(file.path)}
          className={clsx(
            "flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors group",
            selectedFile === file.path
              ? "bg-accent-glow"
              : "hover:bg-bg-hover"
          )}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggle(file);
            }}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          >
            {staged ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
          </button>
          <span
            className={clsx(
              "shrink-0 w-4 text-center font-mono text-xs font-semibold",
              STATUS_COLORS[file.status]
            )}
            title={file.status}
          >
            {STATUS_LABELS[file.status] ?? "?"}
          </span>
          <span className="flex-1 truncate text-xs text-text-primary">
            {file.path}
          </span>
          {file.old_path && file.old_path !== file.path && (
            <span className="text-2xs text-text-muted truncate max-w-24">
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
