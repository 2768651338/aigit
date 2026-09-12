import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore } from "@/stores/aiStore";
import { useRepoEntry } from "@/components/git/RepoEntryDialog";
import type { ViewType } from "@/types";
import {
  FileEditIcon,
  GitBranchIcon,
  FolderIcon,
  ScanSearchIcon,
  MessageSquareIcon,
  BarChartIcon,
  SettingsIcon,
  RefreshIcon,
  PlusIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

interface CommandItem {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run: () => void;
}

interface CommandPaletteProps {
  onViewChange: (view: ViewType) => void;
}

const VIEW_TARGETS: { view: ViewType; icon: typeof FileEditIcon; shortcut: string }[] = [
  { view: "changes", icon: FileEditIcon, shortcut: "Ctrl+1" },
  { view: "branches", icon: GitBranchIcon, shortcut: "Ctrl+2" },
  { view: "files", icon: FolderIcon, shortcut: "Ctrl+3" },
  { view: "review", icon: ScanSearchIcon, shortcut: "Ctrl+4" },
  { view: "chat", icon: MessageSquareIcon, shortcut: "Ctrl+5" },
  { view: "insights", icon: BarChartIcon, shortcut: "Ctrl+6" },
  { view: "settings", icon: SettingsIcon, shortcut: "Ctrl+7" },
];

/** 命令面板（Ctrl+K / ? 唤起）：视图跳转 + 常用操作 + 快捷键速查。 */
export function CommandPalette({ onViewChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const { showRepoEntry } = useRepoEntry();
  const { currentPath } = useRepoStore(
    useShallow((s) => ({ currentPath: s.currentPath })),
  );
  const createSession = useAiStore((s) => s.createSession);
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局唤起：Ctrl/Cmd+K 或 "?"（输入框内不响应 "?"，避免干扰正常输入）。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        target?.isContentEditable === true;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !inInput && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setFilterText("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = VIEW_TARGETS.map((entry) => ({
      id: "nav:" + entry.view,
      label: t("nav." + entry.view),
      group: t("palette.groupNav"),
      shortcut: entry.shortcut,
      icon: entry.icon,
      run: () => onViewChange(entry.view),
    }));
    items.push(
      {
        id: "action:refresh",
        label: t("contextMenu.refreshStatus"),
        group: t("palette.groupActions"),
        shortcut: "Ctrl+R",
        icon: RefreshIcon,
        run: () => useRepoStore.getState().refreshStatus(true),
      },
      {
        id: "action:openRepo",
        label: t("tabs.openNew"),
        group: t("palette.groupActions"),
        icon: PlusIcon,
        run: () => showRepoEntry("open"),
      },    );
    if (currentPath) {
      items.push({
        id: "action:newChat",
        label: t("chat.newSession"),
        group: t("palette.groupActions"),
        icon: MessageSquareIcon,
        run: () => {
          onViewChange("chat");
          void createSession(currentPath);
        },
      });
    }
    return items;
  }, [t, onViewChange, showRepoEntry, currentPath, createSession]);

  const keyword = filterText.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      keyword
        ? commands.filter((c) => c.label.toLowerCase().includes(keyword))
        : commands,
    [commands, keyword],
  );

  useEffect(() => {
    setActive(0);
  }, [filterText]);

  useEffect(() => {
    const node = listRef.current?.children[active];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const activate = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((v) => Math.min(v + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((v) => Math.max(v - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              activate(filtered[active]);
            }
          }}
          placeholder={t("palette.placeholder")}
          className="input border-0 border-b border-border rounded-none text-sm py-3"
          aria-label={t("palette.title")}
        />
        <div ref={listRef} className="max-h-80 overflow-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-text-muted">
              {t("common.noResults")}
            </div>
          )}
          {filtered.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => activate(item)}
                onMouseEnter={() => setActive(index)}
                className={clsx(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                  index === active
                    ? "bg-bg-hover text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover",
                )}
              >
                <Icon size={15} className="shrink-0 text-text-muted" />
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-2xs text-text-muted shrink-0">{item.group}</span>
                {item.shortcut && (
                  <span className="text-2xs font-mono text-text-muted shrink-0">
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="border-t border-border px-4 py-2 text-2xs text-text-muted">
          {t("palette.hint")}
        </div>
      </div>
    </div>
  );
}
