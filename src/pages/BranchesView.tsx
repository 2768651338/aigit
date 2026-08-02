import { useState } from "react";
import { useTranslation } from "react-i18next";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { BranchGraph } from "@/components/git/BranchGraph";
import { MergeRebaseBar } from "@/components/git/MergeRebaseBar";
import { RemotePanel } from "@/components/git/RemotePanel";
import { TagPanel } from "@/components/git/TagPanel";
import { StashPanel } from "@/components/git/StashPanel";
import { SubmodulePanel } from "@/components/git/SubmodulePanel";
import { PullRequestsPanel } from "@/components/git/PullRequestsPanel";
import {
  GitBranchIcon,
  TagIcon,
  ArchiveIcon,
  PackageIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  CheckIcon,
  SpinnerIcon,
  SearchIcon,
} from "@/components/common/Icons";
import { useContextMenu, type MenuItem } from "@/components/common/ContextMenu";
import { confirmDialog } from "@/utils/dialog";
import clsx from "clsx";

type SubTab = "branches" | "pullRequests" | "tags" | "stashes" | "submodules";

export function BranchesView() {
  const { t } = useTranslation();
  const {
    currentPath,
    branches,
    refreshBranches,
    refreshing,
    createBranch,
    switchBranch,
    deleteBranch,
  } = useRepoStore();
  const toast = useToastStore();
  const { show: showMenu } = useContextMenu();

  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [search, setSearch] = useState("");
  const [subTab, setSubTab] = useState<SubTab>("branches");

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("branches.openRepoHint")}
      </div>
    );
  }

  const localBranches = branches.filter((b) => !b.is_remote);
  const remoteBranches = branches.filter((b) => b.is_remote);
  const q = search.trim().toLowerCase();
  const filteredLocal = q
    ? localBranches.filter((b) => b.name.toLowerCase().includes(q))
    : localBranches;
  const filteredRemote = q
    ? remoteBranches.filter((b) => b.name.toLowerCase().includes(q))
    : remoteBranches;

  const handleCreate = async () => {
    if (!newBranchName.trim()) return;
    try {
      await createBranch(newBranchName.trim());
      await refreshBranches();
      await switchBranch(newBranchName.trim());
      setNewBranchName("");
      setShowNewBranch(false);
      toast.success(t("branches.branchCreated", { name: newBranchName.trim() }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.branchCreateFailed"));
    }
  };

  const handleSwitch = async (name: string) => {
    try {
      await switchBranch(name);
      toast.success(t("branches.switched", { name }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.switchFailed"));
    }
  };

  const handleDelete = async (name: string) => {
    const confirmed = await confirmDialog(
      t("branches.deleteTitle"),
      t("branches.deleteConfirm", { name }),
      "warning",
    );
    if (!confirmed) return;
    try {
      await deleteBranch(name);
      toast.success(t("branches.branchDeleted", { name }));
    } catch (e) {
      console.error(e);
      toast.error(formatError(e), t("branches.branchDeleteFailed"));
    }
  };

  const handleRemoteBranch = async (name: string) => {
    if (!currentPath) return;
    try {
      const localName = await gitService.createTrackingBranch(currentPath, name);
      await Promise.all([refreshBranches(true), useRepoStore.getState().refreshLog(true)]);
      toast.success(t("branches.trackingCreated", { name: localName, remote: name }));
    } catch (e) {
      toast.error(formatError(e), t("branches.trackingCreateFailed"));
    }
  };

  const handleBranchContextMenu = (
    e: React.MouseEvent,
    branch: { name: string; is_current: boolean },
  ) => {
    e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: t("branches.switch"),
        icon: <GitBranchIcon size={14} />,
        disabled: branch.is_current,
        onClick: () => handleSwitch(branch.name),
      },
      {
        label: t("branches.newBranch"),
        icon: <PlusIcon size={14} />,
        onClick: () => setShowNewBranch(true),
      },
      {
        label: t("branches.delete"),
        icon: <TrashIcon size={14} />,
        disabled: branch.is_current,
        danger: true,
        onClick: () => handleDelete(branch.name),
      },
      { type: "separator" },
      {
        label: t("contextMenu.refreshStatus"),
        icon: <RefreshIcon size={14} />,
        onClick: () => refreshBranches(),
      },
    ];
    showMenu(e, items);
  };

  const subTabs: { id: SubTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: "branches", label: t("branches.tabBranches"), icon: GitBranchIcon },
    { id: "pullRequests", label: t("branches.tabPullRequests"), icon: CheckIcon },
    { id: "tags", label: t("branches.tabTags"), icon: TagIcon },
    { id: "stashes", label: t("branches.tabStashes"), icon: ArchiveIcon },
    { id: "submodules", label: t("branches.tabSubmodules"), icon: PackageIcon },
  ];

  // Delegate the whole panel to the dedicated component for non-branch tabs.
  if (subTab === "pullRequests") return <PullRequestsPanel onBack={() => setSubTab("branches")} />;
  if (subTab === "tags") return <TagPanel />;
  if (subTab === "stashes") return <StashPanel />;
  if (subTab === "submodules") return <SubmodulePanel />;

  return (
    <div className="flex h-full">
      {/* Branch list sidebar */}
      <div className="w-72 border-r border-border flex flex-col overflow-hidden">
        {/* Sub-tab header */}
        <div className="flex border-b border-border">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = subTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                title={tab.label}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-2xs font-medium transition-colors border-b-2",
                  isActive
                    ? "text-text-primary border-accent"
                    : "text-text-muted hover:text-text-secondary border-transparent hover:bg-bg-hover"
                )}
              >
                <Icon size={13} />
                <span className="hidden xl:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-base font-semibold flex-1">{t("branches.title")}</span>
          <button
            onClick={() => setShowNewBranch(!showNewBranch)}
            className="btn-ghost"
            title={t("branches.newBranch")}
            aria-label={t("branches.newBranch")}
          >
            <PlusIcon size={16} />
          </button>
          <button
            onClick={() => refreshBranches()}
            disabled={refreshing}
            aria-busy={refreshing}
            className="btn-ghost"
            title={t("changes.refresh")}
            aria-label={t("changes.refresh")}
          >
            {refreshing ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
          </button>
        </div>

        {showNewBranch && (
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={t("branches.branchNamePlaceholder")}
              className="input text-sm py-1.5"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="btn-primary px-2.5 py-1.5"
              aria-label={t("branches.newBranch")}
            >
              <CheckIcon size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("branches.local")}
          </div>
          <div className="px-3 pb-2 space-y-1.5">
            <div className="relative">
              <SearchIcon
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("common.search")}
                className="input text-xs py-1.5 pl-7"
              />
            </div>
          </div>
          <div className="px-3 space-y-1">
            {filteredLocal.map((branch) => (
              <div
                key={branch.name}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2 rounded cursor-pointer group focus:outline-none",
                  branch.is_current ? "bg-bg-hover" : "hover:bg-bg-hover"
                )}
                onClick={() => !branch.is_current && handleSwitch(branch.name)}
                onContextMenu={(e) => handleBranchContextMenu(e, branch)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !branch.is_current) {
                    e.preventDefault();
                    handleSwitch(branch.name);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-current={branch.is_current ? "page" : undefined}
              >
                <GitBranchIcon
                  size={16}
                  className={branch.is_current ? "text-text-primary" : "text-text-muted"}
                />
                <span
                  className={clsx(
                    "flex-1 text-sm truncate",
                    branch.is_current ? "text-text-primary font-medium" : "text-text-primary"
                  )}
                >
                  {branch.name}
                </span>
                {!branch.is_current && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(branch.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-danger transition-opacity"
                    aria-label={t("branches.deleteAria", { name: branch.name })}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {filteredRemote.length > 0 && (
            <>
              <div className="px-4 py-2.5 mt-2 text-xs font-semibold uppercase tracking-wider text-text-muted border-t border-border-subtle">
                {t("branches.remote")}
              </div>
              <div className="px-3 space-y-1">
                {filteredRemote.map((branch) => (
                  <div
                    key={branch.name}
                    className="flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-hover cursor-pointer"
                    onClick={() => handleRemoteBranch(branch.name)}
                    title={t("branches.createTracking")}
                  >
                    <GitBranchIcon size={16} className="text-text-muted" />
                    <span className="flex-1 text-sm truncate text-text-secondary">
                      {branch.name}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right panel: merge/rebase bar + commit graph */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <RemotePanel />
        <MergeRebaseBar />
        <BranchGraph />
      </div>
    </div>
  );
}
