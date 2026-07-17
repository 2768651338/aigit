import { useState, useEffect, useRef } from "react";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
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
  const { openRepo } = useRepoStore();
  // Guard against re-opening the last repo on every config change.
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

  // Restore the most recently opened repository on startup, so the user
  // does not have to re-pick it every time the app launches.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    const lastRepo = config?.recent_repos?.[0];
    if (!lastRepo) return;

    hasRestoredRef.current = true;

    // Validate the path is still a valid git repo before opening, so a
    // moved/deleted folder does not produce a confusing error on startup.
    (async () => {
      try {
        await gitService.discoverRepo(lastRepo);
        console.log("[aigit] Restoring last opened repo:", lastRepo);
        await openRepo(lastRepo);
      } catch (e) {
        console.warn("[aigit] Last repo is no longer valid, skipping restore:", lastRepo, e);
      }
    })();
  }, [config, openRepo]);

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex-1 overflow-hidden">
          {activeView === "changes" && <ChangesView />}
          {activeView === "branches" && <BranchesView />}
          {activeView === "review" && <ReviewView />}
          {activeView === "chat" && <ChatView />}
          {activeView === "settings" && <SettingsView />}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
