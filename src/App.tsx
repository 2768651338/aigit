import { useState, useEffect, useRef } from "react";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Toaster } from "@/components/common/Toaster";
import { RepoEntryProvider } from "@/components/git/RepoEntryDialog";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import {
  ContextMenuProvider,
  useContextMenu,
  type MenuItem,
} from "@/components/common/ContextMenu";
import { RefreshIcon, CopyIcon } from "@/components/common/Icons";
import { ChangesView } from "@/pages/ChangesView";
import { BranchesView } from "@/pages/BranchesView";
import { ReviewView } from "@/pages/ReviewView";
import { ChatView } from "@/pages/ChatView";
import { InsightsView } from "@/pages/InsightsView";
import { SettingsView } from "@/pages/SettingsView";
import { useSettingsStore } from "@/stores/aiStore";
import { useRepoStore } from "@/stores/repoStore";
import { gitService } from "@/services/git";
import { applyTheme, type ThemeMode } from "@/utils/theme";
import type { ViewType } from "@/types";

export default function App() {
  return (
    <ContextMenuProvider>
      <RepoEntryProvider>
        <AppShell />
      </RepoEntryProvider>
    </ContextMenuProvider>
  );
}

function AppShell() {
  const { i18n, t } = useTranslation();
  const [activeView, setActiveView] = useState<ViewType>("changes");
  const { config, loadConfig } = useSettingsStore();
  const { openRepo, setActiveRepo, currentPath, refreshStatus } = useRepoStore();
  const { show: showMenu } = useContextMenu();
  // Guard against re-opening tabs on every config change.
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Apply font size from config
  useEffect(() => {
    if (config) {
      document.documentElement.style.fontSize = `${config.ui.font_size}px`;
    }
  }, [config]);

  // Apply theme from config (light / dark / system). For "system" the
  // utility registers a media-query listener so the theme tracks OS changes.
  useEffect(() => {
    applyTheme((config?.ui?.theme as ThemeMode) ?? "dark");
  }, [config?.ui?.theme]);

  // Apply language from config
  useEffect(() => {
    if (config?.ui?.language && i18n.language !== config.ui.language) {
      i18n.changeLanguage(config.ui.language);
    }
  }, [config, i18n]);

  // Global keyboard shortcuts:
  //   Cmd/Ctrl + 1..5  — switch views (changes/branches/review/chat/settings)
  //   Cmd/Ctrl + R     — refresh current repo status
  // Ignore when the user is typing in an input/textarea/select or using
  // modifier combos we don't handle (e.g. Cmd/Ctrl+Shift+R devtools reload).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key >= "1" && e.key <= "6") {
        const views: ViewType[] = ["changes", "branches", "review", "chat", "insights", "settings"];
        const idx = Number(e.key) - 1;
        if (idx < views.length) {
          e.preventDefault();
          setActiveView(views[idx]);
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        useRepoStore.getState().refreshStatus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Restore the set of open tabs from the previous session.
  // Falls back to recent_repos[0] for older configs that predate open_repos.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    const openRepos = config?.open_repos ?? [];
    const activeRepo = config?.active_repo ?? null;
    const recentFirst = config?.recent_repos?.[0];
    hasRestoredRef.current = true;

    (async () => {
      // Prefer the saved tab list; otherwise restore just the last repo.
      const list = openRepos.length > 0 ? openRepos : recentFirst ? [recentFirst] : [];
      for (const path of list) {
        try {
          await gitService.discoverRepo(path);
          await openRepo(path);
        } catch (e) {
          console.warn("[aigit] Skipping invalid saved repo:", path, e);
        }
      }
      // Activate the previously active tab if it was restored.
      if (activeRepo) {
        const state = useRepoStore.getState();
        if (state.tabs[activeRepo]) {
          setActiveRepo(activeRepo);
        }
      }
    })();
  }, [config, openRepo, setActiveRepo]);

  // 全局回退右键菜单：在非特殊区域右键时显示「刷新仓库状态 / 复制选中内容」。
  // 文件列表、分支列表等子组件会调用 e.stopPropagation() 阻止冒泡到此处，
  // 从而显示各自的上下文菜单。
  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    // 输入框内交给原生菜单（复制 / 粘贴 / 拼写检查）
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target?.isContentEditable === true
    ) {
      return;
    }

    const items: MenuItem[] = [];
    if (currentPath) {
      items.push({
        label: t("contextMenu.refreshStatus"),
        icon: <RefreshIcon size={14} />,
        onClick: () => refreshStatus(),
      });
    }
    // 文本选中时提供「复制」
    const selection = window.getSelection?.();
    const text = selection?.toString().trim();
    if (text) {
      items.push({
        label: t("contextMenu.copy"),
        icon: <CopyIcon size={14} />,
        onClick: () => {
          navigator.clipboard?.writeText(text).catch(() => {});
        },
      });
    }
    if (items.length === 0) return;
    showMenu(e, items);
  };

  return (
    <ErrorBoundary>
      <div
        className="flex flex-col h-screen bg-bg-base text-text-primary"
        onContextMenu={handleContextMenu}
      >
        <div className="flex flex-1 overflow-hidden">
          <Sidebar activeView={activeView} onViewChange={setActiveView} />
          <main className="flex-1 flex flex-col overflow-hidden">
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary>
                {activeView === "changes" && <ChangesView />}
                {activeView === "branches" && <BranchesView />}
                {activeView === "review" && <ReviewView onNavigateChanges={() => setActiveView("changes")} />}
                {activeView === "chat" && <ChatView />}
                {activeView === "insights" && <InsightsView />}
                {activeView === "settings" && <SettingsView />}
              </ErrorBoundary>
            </div>
          </main>
        </div>
        <StatusBar />
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}
