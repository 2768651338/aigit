import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { gitService } from "@/services/git";
import { XIcon, PlusIcon, FolderIcon } from "@/components/common/Icons";
import clsx from "clsx";

/**
 * Derive a short display name for a repo tab.
 * Prefers the loaded RepoInfo.name; otherwise falls back to the last
 * path segment so we can show something useful before the repo info
 * has finished loading.
 */
function tabLabel(path: string, name?: string | null): string {
  if (name) return name;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function TabBar() {
  const { t } = useTranslation();
  const { tabs, tabOrder, activePath, setActiveRepo, closeRepoTab, openRepo } =
    useRepoStore();
  const toast = useToastStore();

  const handleOpenNew = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    try {
      const repoPath = await gitService.discoverRepo(selected);
      await openRepo(repoPath);
    } catch (e) {
      console.error("[aigit] Open repo failed from TabBar:", e);
      toast.error(formatError(e), t("tabs.openFailed"));
    }
  };

  const handleClose = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await closeRepoTab(path);
  };

  if (tabOrder.length === 0) {
    // Still render the bar so the "+" affordance is discoverable.
    return (
      <div className="flex items-center px-2 h-10 bg-bg-surface border-b border-border">
        <button
          onClick={handleOpenNew}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t("tabs.openNew")}
        >
          <FolderIcon size={14} />
          {t("sidebar.openRepo")}
        </button>
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <div className="flex items-stretch h-10 bg-bg-surface border-b border-border overflow-x-auto">
      <div className="flex items-stretch">
        {tabOrder.map((path) => {
          const tab = tabs[path];
          const isActive = path === activePath;
          const label = tabLabel(path, tab?.repoInfo?.name);
          const branch = tab?.repoInfo?.current_branch ?? null;
          return (
            <div
              key={path}
              onClick={() => setActiveRepo(path)}
              className={clsx(
                "group flex items-center gap-2 pl-3.5 pr-2 cursor-pointer border-r border-border text-sm transition-colors min-w-0",
                isActive
                  ? "bg-bg-base text-text-primary"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              )}
              title={path}
            >
              <span className="truncate max-w-[160px]">{label}</span>
              {branch && (
                <span className="text-xs text-text-muted truncate max-w-[120px] hidden sm:inline">
                  {branch}
                </span>
              )}
              <button
                onClick={(e) => handleClose(path, e)}
                className={clsx(
                  "shrink-0 p-1 rounded hover:bg-bg-elevated hover:text-danger transition-colors",
                  isActive ? "text-text-muted" : "text-text-muted opacity-0 group-hover:opacity-100"
                )}
                title={t("tabs.close")}
                aria-label={t("tabs.close")}
              >
                <XIcon size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={handleOpenNew}
        className="flex items-center justify-center w-9 shrink-0 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        title={t("tabs.openNew")}
        aria-label={t("tabs.openNew")}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
