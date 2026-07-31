import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import type { ViewType } from "@/types";
import {
  FileEditIcon,
  GitBranchIcon,
  MessageSquareIcon,
  ScanSearchIcon,
  BarChartIcon,
  SettingsIcon,
  FolderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckIcon,
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
  shortcut: string;
}[] = [
  { id: "changes", labelKey: "nav.changes", icon: FileEditIcon, shortcut: "1" },
  { id: "branches", labelKey: "nav.branches", icon: GitBranchIcon, shortcut: "2" },
  { id: "review", labelKey: "nav.review", icon: ScanSearchIcon, shortcut: "3" },
  { id: "chat", labelKey: "nav.chat", icon: MessageSquareIcon, shortcut: "4" },
  { id: "insights", labelKey: "nav.insights", icon: BarChartIcon, shortcut: "5" },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon, shortcut: "6" },
];

/** Extract a human-readable repo name from an absolute path. */
function repoName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { t } = useTranslation();
  const { fileStatuses, openRepo, tabOrder, activePath } = useRepoStore();
  const { config } = useSettingsStore();
  const changedCount = fileStatuses.length;
  const [recentCollapsed, setRecentCollapsed] = useState(false);

  // Show up to 5 recent repos. Already-open repos are still listed (with a
  // visual marker) so the user can see their status at a glance.
  const recentRepos = (config?.recent_repos ?? []).slice(0, 5);
  const openSet = new Set(tabOrder);

  return (
    <aside className="flex flex-col w-64 bg-bg-surface border-r border-border h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <span className="font-semibold text-base tracking-tight">aigit</span>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-3 space-y-1" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              title={`${t(item.labelKey)} (${t("sidebar.shortcutPrefix")}${item.shortcut})`}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                isActive
                  ? "text-text-primary bg-bg-hover"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              )}
            >
              <Icon size={18} />
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              {item.id === "changes" && changedCount > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary"
                  aria-label={t("sidebar.changesCount", { count: changedCount })}
                >
                  {changedCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Recent repositories — collapsible quick-access list. */}
      {recentRepos.length > 0 && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setRecentCollapsed((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
            aria-expanded={!recentCollapsed}
          >
            {recentCollapsed ? (
              <ChevronRightIcon size={12} />
            ) : (
              <ChevronDownIcon size={12} />
            )}
            {t("sidebar.recentRepos")}
          </button>
          {!recentCollapsed && (
            <div className="space-y-0.5">
              {recentRepos.map((repo) => {
                const isOpen = openSet.has(repo);
                const isActive = repo === activePath;
                return (
                  <button
                    key={repo}
                    type="button"
                    onClick={() => openRepo(repo)}
                    title={repo}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors text-left",
                      isActive
                        ? "bg-bg-hover text-text-primary"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    )}
                  >
                    <FolderIcon size={14} className="shrink-0 text-text-muted" />
                    <span className="flex-1 truncate">{repoName(repo)}</span>
                    {isOpen && (
                      <CheckIcon size={12} className="shrink-0 text-accent" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Footer: AI provider status */}
      <div className="px-4 py-3 border-t border-border">
        <div className="text-xs text-text-muted truncate">
          {config?.ai.active_provider ?? t("sidebar.notSet")}
        </div>
      </div>
    </aside>
  );
}
