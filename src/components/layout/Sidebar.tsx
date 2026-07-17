import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import type { ViewType } from "@/types";
import { gitService } from "@/services/git";
import {
  FileEditIcon,
  GitBranchIcon,
  MessageSquareIcon,
  ScanSearchIcon,
  SettingsIcon,
  FolderIcon,
  PlusIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

interface SidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const NAV_ITEMS: {
  id: ViewType;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { id: "changes", labelKey: "nav.changes", icon: FileEditIcon },
  { id: "branches", labelKey: "nav.branches", icon: GitBranchIcon },
  { id: "review", labelKey: "nav.review", icon: ScanSearchIcon },
  { id: "chat", labelKey: "nav.chat", icon: MessageSquareIcon },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { t } = useTranslation();
  const { repoInfo, fileStatuses } = useRepoStore();
  const { config } = useSettingsStore();
  const changedCount = fileStatuses.length;

  const handleOpenRepo = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      try {
        const repoPath = await gitService.discoverRepo(selected);
        await useRepoStore.getState().openRepo(repoPath);
      } catch {
        // not a git repo - try to init?
        console.error("Not a git repository");
      }
    }
  };

  return (
    <aside className="flex flex-col w-56 bg-bg-surface border-r border-border h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border">
        <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
          <span className="text-bg-base font-bold text-xs">ai</span>
        </div>
        <span className="font-semibold text-sm tracking-tight">aigit</span>
      </div>

      {/* Repo selector */}
      <div className="px-2 pt-3 pb-2">
        <button
          onClick={handleOpenRepo}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-bg-hover transition-colors group"
        >
          <FolderIcon size={16} className="text-text-secondary group-hover:text-accent" />
          <div className="flex-1 text-left min-w-0">
            {repoInfo ? (
              <>
                <div className="text-xs font-medium truncate text-text-primary">
                  {repoInfo.name}
                </div>
                <div className="text-2xs text-text-muted truncate">
                  {repoInfo.current_branch ?? t("sidebar.detached")}
                </div>
              </>
            ) : (
              <div className="text-xs text-text-secondary">{t("sidebar.openRepo")}</div>
            )}
          </div>
          <PlusIcon size={14} className="text-text-muted" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={clsx(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "text-accent bg-accent-glow"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              )}
            >
              <Icon size={16} />
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              {item.id === "changes" && changedCount > 0 && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary">
                  {changedCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer: AI provider status */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center gap-2 text-2xs text-text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
          <span className="capitalize">{config?.ai.active_provider ?? t("sidebar.notSet")}</span>
        </div>
      </div>
    </aside>
  );
}
