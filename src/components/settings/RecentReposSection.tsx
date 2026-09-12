import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useRepoStore } from "@/stores/repoStore";
import { FolderIcon } from "@/components/common/Icons";
import clsx from "clsx";

/** "Recent repositories" settings section. Reads the repo store directly. */
export function RecentReposSection({ repos }: { repos: string[] }) {
  const { t } = useTranslation();
  const { openRepo, openTabs } = useRepoStore(
    useShallow((s) => ({ openRepo: s.openRepo, openTabs: s.tabOrder })),
  );

  if (repos.length === 0) return null;

  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-4">
        {t("settings.recentRepos")}
      </h3>
      <div className="space-y-2">
        {repos.map((repo, idx) => {
          const isOpen = openTabs.includes(repo);
          return (
            <button
              key={idx}
              onClick={() => openRepo(repo)}
              disabled={isOpen}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded text-sm transition-colors text-left",
                isOpen
                  ? "bg-bg-elevated text-text-muted cursor-default"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              )}
              title={isOpen ? t("settings.recentRepoAlreadyOpen") : t("settings.recentRepoOpen")}
            >
              <FolderIcon size={14} className="shrink-0 text-text-muted" />
              <span className="flex-1 truncate">{repo}</span>
              {isOpen && (
                <span className="text-xs text-text-muted shrink-0">
                  {t("settings.recentRepoAlreadyOpen")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
