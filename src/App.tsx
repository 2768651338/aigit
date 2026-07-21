import { useState, useEffect, useRef } from "react";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
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
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <div className="flex-1 overflow-hidden">
            {activeView === "changes" && <ChangesView />}
            {activeView === "branches" && <BranchesView />}
            {activeView === "review" && <ReviewView />}
            {activeView === "chat" && <ChatView />}
            {activeView === "settings" && <SettingsView />}
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
