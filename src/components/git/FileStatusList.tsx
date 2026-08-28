import { useState, useRef, useEffect } from "react";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { useTranslation } from "react-i18next";
import { formatError } from "@/utils/error";
import type { FileStatus } from "@/types";
import {
  PlusIcon,
  MinusIcon,
  UndoIcon,
  CheckIcon,
  XIcon,
  RefreshIcon,
  EyeOffIcon,
} from "@/components/common/Icons";
import { useContextMenu, type MenuItem } from "@/components/common/ContextMenu";
import { confirmDialog } from "@/utils/dialog";
import { buildIgnoreTargets } from "@/utils/gitignore";
import { gitService } from "@/services/git";
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
  const {
    fileStatuses,
    selectedFile,
    selectFile,
    stageFiles,
    unstageFiles,
    discardFiles,
    refreshStatus,
    currentPath,
  } = useRepoStore();
  const toast = useToastStore();
  const { show: showMenu } = useContextMenu();
  const [search, setSearch] = useState("");
  const files = useMemoFilteredFiles(fileStatuses, staged, search);
  const totalCount = fileStatuses.filter((f) => f.staged === staged).length;

  // Batch selection state (transient UI state — not persisted in the store).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Track the last clicked row index for Shift+click range selection.
  const lastClickedIdx = useRef<number | null>(null);

  // Clear selection whenever the active repo's file set changes shape or
  // the search filter changes, so we never hold "invisible" selections.
  useEffect(() => {
    setSelected(new Set());
    lastClickedIdx.current = null;
  }, [search, staged]);

  const allVisibleSelected = files.length > 0 && files.every((f) => selected.has(f.path));

  // Select-all toggle exposed in the batch bar so users can quickly grab every
  // visible (post-filter) file without Shift-clicking the whole range.
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.path)));
    }
    lastClickedIdx.current = null;
  };

  const toggleOne = (file: FileStatus, idx: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIdx.current !== null) {
        const from = Math.min(lastClickedIdx.current, idx);
        const to = Math.max(lastClickedIdx.current, idx);
        // Range toggle: if the anchor was selected, select the whole range;
        // otherwise deselect the whole range.
        const anchorSelected = prev.has(files[lastClickedIdx.current].path);
        for (let i = from; i <= to; i++) {
          if (anchorSelected) next.add(files[i].path);
          else next.delete(files[i].path);
        }
      } else {
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
      }
      return next;
    });
    lastClickedIdx.current = idx;
  };

  const clearSelection = () => {
    setSelected(new Set());
    lastClickedIdx.current = null;
  };

  const handleToggle = (file: FileStatus) => {
    if (staged) {
      unstageFiles([file.path]);
    } else {
      stageFiles([file.path]);
    }
  };

  // 文件行右键菜单：暂存 / 取消暂存 / 丢弃修改 / 查看 diff + 刷新状态。
  // stopPropagation 阻止冒泡到 AppShell 的全局回退菜单。
  const handleFileContextMenu = (e: React.MouseEvent, file: FileStatus) => {
    e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: t(staged ? "fileList.unstage" : "fileList.stage", { file: file.path }),
        icon: staged ? <MinusIcon size={14} /> : <PlusIcon size={14} />,
        onClick: () => handleToggle(file),
      },
      {
        label: t("fileList.viewDiff"),
        icon: <CheckIcon size={14} />,
        disabled: selectedFile === file.path,
        onClick: () => selectFile(file.path),
      },
    ];

    // 丢弃修改：仅对未暂存的已跟踪文件生效
    if (!staged && file.status !== "untracked") {
      items.push({
        label: t("fileList.discard"),
        icon: <UndoIcon size={14} />,
        danger: true,
        onClick: () => handleDiscard(file),
      });
    }

    // 忽略规则（写入根 .gitignore）：文件 / 所在目录 / 上一级目录
    items.push({ type: "separator" });
    items.push(...buildIgnoreMenuItems(file));

    if (currentPath) {
      items.push({ type: "separator" });
      items.push({
        label: t("contextMenu.refreshStatus"),
        icon: <RefreshIcon size={14} />,
        onClick: () => refreshStatus(true),
      });
    }

    showMenu(e, items);
  };

  // Discard working-tree modifications for a single file.
  // Destructive — requires user confirmation via native dialog.
  const handleDiscard = async (file: FileStatus, e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  // 将忽略规则追加到仓库根 .gitignore 并刷新状态。
  // 已跟踪的文件不受 .gitignore 影响——用 info 提示兜底，避免"点了没效果"的困惑。
  const handleIgnore = async (patterns: string[], file: FileStatus) => {
    if (!currentPath || patterns.length === 0) return;
    try {
      const added = await gitService.addGitignoreEntries(currentPath, patterns);
      // Force: a poll may be in flight; its pre-gitignore response must not
      // silently swallow this refresh.
      await refreshStatus(true);
      if (added.length === 0) {
        toast.info(t("fileList.ignoreAlready"));
        return;
      }
      if (!staged && file.status === "untracked") {
        toast.success(t("fileList.ignoreSuccess"));
      } else {
        toast.info(t("fileList.ignoreTrackedHint"));
      }
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("fileList.ignoreFailed"));
    }
  };

  // 忽略菜单项：文件本身 / 所在目录 / 所在目录的上一级。
  // label 展示相对路径，title 展示将写入 .gitignore 的精确规则（根锚定）。
  const buildIgnoreMenuItems = (file: FileStatus): MenuItem[] => {
    const targets = buildIgnoreTargets(file.path);
    const display = (pattern: string) => pattern.replace(/^\//, "");
    const items: MenuItem[] = [
      {
        label: t("fileList.ignoreFile", { path: display(targets.file) }),
        title: targets.file,
        icon: <EyeOffIcon size={14} />,
        onClick: () => handleIgnore([targets.file], file),
      },
    ];
    if (targets.dir) {
      const dirPattern = targets.dir;
      items.push({
        label: t("fileList.ignoreDir", { path: display(dirPattern) }),
        title: dirPattern,
        icon: <EyeOffIcon size={14} />,
        onClick: () => handleIgnore([dirPattern], file),
      });
    }
    if (targets.parentDir) {
      const parentPattern = targets.parentDir;
      items.push({
        label: t("fileList.ignoreParentDir", { path: display(parentPattern) }),
        title: parentPattern,
        icon: <EyeOffIcon size={14} />,
        onClick: () => handleIgnore([parentPattern], file),
      });
    }
    return items;
  };

  // Batch operations — act on the current selection.
  const selectedPaths = Array.from(selected);
  const selectedCount = selectedPaths.length;

  const handleBatchStage = async () => {
    if (selectedCount === 0) return;
    try {
      if (staged) {
        await unstageFiles(selectedPaths);
      } else {
        await stageFiles(selectedPaths);
      }
      clearSelection();
    } catch (e) {
      console.error(e);
      toast.error(
        formatError(e),
        staged ? t("fileList.batchUnstageFailed") : t("fileList.batchStageFailed"),
      );
    }
  };

  const handleBatchDiscard = async () => {
    if (selectedCount === 0) return;
    const confirmed = await confirmDialog(
      t("fileList.batchDiscardTitle"),
      t("fileList.batchDiscardConfirm", { count: selectedCount }),
      "warning"
    );
    if (!confirmed) return;
    try {
      await discardFiles(selectedPaths);
      toast.success(t("fileList.batchDiscarded", { count: selectedCount }));
      clearSelection();
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("fileList.batchDiscardFailed"));
    }
  };

  if (totalCount === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        {staged ? t("fileList.noStaged") : t("fileList.noChanges")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {totalCount > 8 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("common.search")}
          className="input text-xs py-1.5"
        />
      )}

      {/* Batch action bar — shown when one or more rows are selected. */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 bg-bg-elevated border border-border rounded text-xs">
          <span className="text-text-secondary font-medium">
            {t("fileList.selectedCount", { count: selectedCount })}
          </span>
          <button
            type="button"
            onClick={toggleAllVisible}
            className="btn-ghost text-2xs"
            title={t("fileList.selectAll")}
          >
            {t("fileList.selectAll")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleBatchStage}
            className="btn-ghost text-2xs"
            title={staged ? t("fileList.batchUnstage") : t("fileList.batchStage")}
          >
            {staged ? <MinusIcon size={13} /> : <PlusIcon size={13} />}
            {staged ? t("fileList.batchUnstage") : t("fileList.batchStage")}
          </button>
          {/* Discard only applies to unstaged tracked modifications. */}
          {!staged && (
            <button
              type="button"
              onClick={handleBatchDiscard}
              className="btn-ghost text-2xs hover:text-danger"
              title={t("fileList.batchDiscard")}
            >
              <UndoIcon size={13} />
              {t("fileList.batchDiscard")}
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
            title={t("fileList.clearSelection")}
            aria-label={t("fileList.clearSelection")}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-center text-text-muted text-sm py-6">–</div>
      ) : (
        files.map((file, idx) => {
          const isSelected = selected.has(file.path);
          return (
            <div
              key={`${file.path}-${file.staged}`}
              onClick={() => selectFile(file.path)}
              onContextMenu={(e) => {
                selectFile(file.path);
                handleFileContextMenu(e, file);
              }}
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
              {/* Batch-selection checkbox. Clicking it does NOT trigger the
                  row's diff-selection onClick. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOne(file, idx, e.shiftKey);
                }}
                aria-label={isSelected ? t("fileList.clearSelection") : t("fileList.selectAll")}
                className={clsx(
                  "shrink-0 w-4 h-4 flex items-center justify-center rounded border transition-colors",
                  isSelected
                    ? "bg-accent border-accent text-bg-base"
                    : "border-border-strong text-transparent hover:border-accent"
                )}
              >
                {isSelected && <CheckIcon size={11} />}
              </button>
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
          );
        })
      )}
    </div>
  );
}

function useMemoFilteredFiles(files: FileStatus[], staged: boolean, search: string) {
  const list = files.filter((f) => f.staged === staged);
  if (!search.trim()) return list;
  const q = search.trim().toLowerCase();
  return list.filter((f) => f.path.toLowerCase().includes(q));
}
