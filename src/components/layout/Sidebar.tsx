import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { useSettingsStore } from "@/stores/aiStore";
import { useContextMenu, type MenuItem } from "@/components/common/ContextMenu";
import { useModelProfileSwitch } from "@/hooks/useModelProfileSwitch";
import { activeProfileOf, providerLabel } from "@/utils/modelProfile";
import { useRepoEntry } from "@/components/git/RepoEntryDialog";
import { pathLeaf } from "@/utils/path";
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
  PlusIcon,
  XIcon,
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
  { id: "files", labelKey: "nav.files", icon: FolderIcon, shortcut: "3" },
  { id: "review", labelKey: "nav.review", icon: ScanSearchIcon, shortcut: "4" },
  { id: "chat", labelKey: "nav.chat", icon: MessageSquareIcon, shortcut: "5" },
  { id: "insights", labelKey: "nav.insights", icon: BarChartIcon, shortcut: "6" },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon, shortcut: "7" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { t } = useTranslation();
  const {
    fileStatuses,
    openRepo,
    tabOrder,
    tabs,
    activePath,
    setActiveRepo,
    closeRepoTab,
    moveRepoTab,
  } = useRepoStore(
    useShallow((s) => ({
      fileStatuses: s.fileStatuses,
      openRepo: s.openRepo,
      tabOrder: s.tabOrder,
      tabs: s.tabs,
      activePath: s.activePath,
      setActiveRepo: s.setActiveRepo,
      closeRepoTab: s.closeRepoTab,
      moveRepoTab: s.moveRepoTab,
    })),
  );
  const { config } = useSettingsStore();
  const { showRepoEntry } = useRepoEntry();
  const { show: showContextMenu } = useContextMenu();
  const switchProfile = useModelProfileSwitch();
  const activeProfile = activeProfileOf(config);
  const changedCount = fileStatuses.length;
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  // Drag-to-reorder state for the open-repo list. `draggingPath` is the row
  // being dragged; `dropHint` only drives the insertion indicator — the drop
  // position itself is recomputed from the event so a stale hint can't
  // misplace a repo.
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    path: string;
    before: boolean;
  } | null>(null);

  const clearDragState = () => {
    setDraggingPath(null);
    setDropHint(null);
  };

  // Footer menu: one-click switch between saved model profiles.
  const showProfileMenu = (e: React.MouseEvent) => {
    const profiles = config?.profiles ?? [];
    const items: MenuItem[] = profiles.map((profile) => ({
      label: profile.name,
      title: `${providerLabel(profile.provider)} · ${profile.model || profile.base_url}`,
      icon:
        profile.id === config?.ai.active_profile_id ? (
          <CheckIcon size={14} />
        ) : undefined,
      onClick: () => void switchProfile(profile.id),
    }));
    items.push({ type: "separator" });
    items.push({
      label: t("sidebar.modelSettings"),
      icon: <SettingsIcon size={14} />,
      onClick: () => onViewChange("settings"),
    });
    showContextMenu(e, items);
  };

  // Show up to 5 recent repos. Already-open repos are still listed (with a
  // visual marker) so the user can see their status at a glance.
  const recentRepos = (config?.recent_repos ?? []).slice(0, 5);
  const openSet = new Set(tabOrder);

  return (
    <aside className="flex flex-col w-64 bg-bg-surface border-r border-border h-full">
      {/* Scrollable middle region so many open repos don't clip the
          footer off-screen. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
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

      {/* Open repositories — moved here from the top tab bar. Always
          rendered so the "open repo" affordance stays discoverable when
          the list is empty. */}
      <div className="px-3 pb-2" aria-label={t("sidebar.openRepos")}>
        <div className="flex items-center justify-between pl-3 pr-1 py-1">
          <span
            className="text-2xs font-semibold uppercase tracking-wider text-text-muted"
            title={tabOrder.length > 1 ? t("sidebar.dragReorderHint") : undefined}
          >
            {t("sidebar.openRepos")}
          </span>
          <button
            type="button"
            onClick={() => showRepoEntry("open")}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t("tabs.openNew")}
            aria-label={t("tabs.openNew")}
          >
            <PlusIcon size={14} />
          </button>
        </div>
        {tabOrder.length === 0 ? (
          <button
            type="button"
            onClick={() => showRepoEntry("open")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-dashed border-border text-xs text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            title={t("sidebar.openRepo")}
          >
            <FolderIcon size={14} />
            {t("sidebar.openRepo")}
          </button>
        ) : (
          <div className="space-y-0.5">
            {tabOrder.map((path) => {
              const tab = tabs[path];
              const isActive = path === activePath;
              const label = tab?.repoInfo?.name ?? pathLeaf(path);
              const branch = tab?.repoInfo?.current_branch ?? null;
              const isDragging = draggingPath === path;
              const showHintBefore = dropHint?.path === path && dropHint.before;
              const showHintAfter = dropHint?.path === path && !dropHint.before;
              return (
                <div
                  key={path}
                  className={clsx("group relative", isDragging && "opacity-50")}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", path);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingPath(path);
                  }}
                  onDragOver={(e) => {
                    // The dragged row itself is not a drop target; without
                    // preventDefault the browser shows a "no drop" cursor.
                    if (draggingPath === null || draggingPath === path) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const before =
                      e.clientY < rect.top + rect.height / 2;
                    setDropHint((prev) =>
                      prev?.path === path && prev.before === before
                        ? prev
                        : { path, before },
                    );
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDragLeave={() => {
                    // Sibling transitions fire leave for the old row after
                    // the new row's over — only clear our own hint.
                    setDropHint((prev) => (prev?.path === path ? null : prev));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingPath !== null && draggingPath !== path) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      moveRepoTab(
                        draggingPath,
                        path,
                        before ? "before" : "after"
                      );
                    }
                    clearDragState();
                  }}
                  onDragEnd={clearDragState}
                >
                  {showHintBefore && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -top-px left-2 right-2 z-10 h-0.5 rounded bg-accent"
                    />
                  )}
                  {showHintAfter && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-px left-2 right-2 z-10 h-0.5 rounded bg-accent"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveRepo(path)}
                    title={path}
                    aria-current={isActive ? "true" : undefined}
                    className={clsx(
                      "w-full flex flex-col items-start gap-0.5 pl-3 pr-8 py-1.5 rounded text-left transition-colors",
                      isActive
                        ? "bg-bg-hover text-text-primary"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    )}
                  >
                    <span className="w-full truncate text-sm">{label}</span>
                    {branch && (
                      <span className="w-full truncate text-xs text-text-muted">
                        {branch}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeRepoTab(path);
                    }}
                    className={clsx(
                      "absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:bg-bg-elevated hover:text-danger transition-colors",
                      isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    )}
                    title={t("sidebar.closeRepo")}
                    aria-label={t("sidebar.closeRepo", { name: label })}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                    <span className="flex-1 truncate">{pathLeaf(repo)}</span>
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

      </div>

      {/* Footer: active model profile with a one-click switcher */}
      <div className="px-2 py-2 border-t border-border">
        <button
          type="button"
          onClick={showProfileMenu}
          aria-haspopup="menu"
          title={t("sidebar.modelProfiles")}
          aria-label={t("sidebar.modelProfiles")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <span className="flex-1 text-left truncate">
            {activeProfile?.name ?? config?.ai.active_provider ?? t("sidebar.notSet")}
          </span>
          {activeProfile && (
            <span className="shrink-0 text-2xs">
              {providerLabel(activeProfile.provider)}
            </span>
          )}
          <ChevronDownIcon size={12} className="shrink-0" />
        </button>
      </div>
    </aside>
  );
}
