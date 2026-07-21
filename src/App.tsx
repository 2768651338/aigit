import { useState, useEffect, useRef } from "react";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Toaster } from "@/components/common/Toaster";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ChangesView } from "@/pages/ChangesView";
import { BranchesView } from "@/pages/BranchesView";
import { ReviewView } from "@/pages/ReviewView";
import { ChatView } from "@/pages/ChatView";
import { SettingsView } from "@/pages/SettingsView";
import { useSettingsStore } from "@/stores/aiStore";
import { useRepoStore } from "@/stores/repoStore";
import { gitService } from "@/services/git";
import type { ViewType } from "@/types";

export default function App() {
  const { i18n } = useTranslation();
  const [activeView, setActiveView] = useState<ViewType>("changes");
  const { config, loadConfig } = useSettingsStore();
  const { openRepo, setActiveRepo } = useRepoStore();
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

      if (e.key >= "1" && e.key <= "5") {
        const views: ViewType[] = ["changes", "branches", "review", "chat", "settings"];
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

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-bg-base text-text-primary">
        <div className="flex flex-1 overflow-hidden">
          <Sidebar activeView={activeView} onViewChange={setActiveView} />
          <main className="flex-1 flex flex-col overflow-hidden">
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary>
                {activeView === "changes" && <ChangesView />}
                {activeView === "branches" && <BranchesView />}
                {activeView === "review" && <ReviewView />}
                {activeView === "chat" && <ChatView />}
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
