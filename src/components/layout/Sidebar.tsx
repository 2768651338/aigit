import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import type { ViewType } from "@/types";
import {
  FileEditIcon,
  GitBranchIcon,
  MessageSquareIcon,
  ScanSearchIcon,
  SettingsIcon,
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
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon, shortcut: "5" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { t } = useTranslation();
  const { fileStatuses } = useRepoStore();
  const { config } = useSettingsStore();
  const changedCount = fileStatuses.length;

  return (
    <aside className="flex flex-col w-64 bg-bg-surface border-r border-border h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <span className="font-semibold text-base tracking-tight">aigit</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-1" aria-label="Main navigation">
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

      {/* Footer: AI provider status */}
      <div className="px-4 py-3 border-t border-border">
        <div className="text-xs text-text-muted truncate">
          {config?.ai.active_provider ?? t("sidebar.notSet")}
        </div>
      </div>
    </aside>
  );
}
