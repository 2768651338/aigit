import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { SubmoduleInfo } from "@/types";
import {
  PackageIcon,
  RefreshIcon,
  PlusIcon,
  CheckIcon,
  TrashIcon,
  AlertCircleIcon,
  SpinnerIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

/**
 * Submodule management panel.
 *
 * Lists all submodules with their tracked SHA, URL, and status (modified /
 * uninitialized / etc.). Supports:
 *   - Add: prompts for URL, path, optional tracking branch
 *   - Update: `git submodule update --remote --merge` for one or all
 *   - Remove: deinitializes + removes from .gitmodules + working tree
 *
 * The right panel shows full submodule details when one is selected.
 */
export function SubmodulePanel() {
  const { t } = useTranslation();
  const {
    currentPath,
    submodules,
    refreshing,
    refreshSubmodules,
    updateSubmodule,
    addSubmodule,
    removeSubmodule,
  } = useRepoStore();
  const toast = useToastStore();

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [selected, setSelected] = useState<SubmoduleInfo | null>(null);

  useEffect(() => {
    if (currentPath) {
      void refreshSubmodules();
    }
  }, [currentPath, refreshSubmodules]);

  useEffect(() => {
    if (selected) {
      const stillExists = submodules?.some((s) => s.name === selected.name);
      if (!stillExists) {
        setSelected(null);
      }
    }
  }, [submodules, selected]);

  const handleAdd = async () => {
    const u = url.trim();
    const p = path.trim();
    if (!u || !p) return;
    setSaving(true);
    try {
      await addSubmodule(u, p, branch.trim() || undefined);
      toast.success(
        t("submodules.submoduleAdded", { name: p }),
        t("submodules.title")
      );
      setUrl("");
      setPath("");
      setBranch("");
      setShowForm(false);
    } catch (e) {
      toast.error(formatError(e), t("submodules.submoduleFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (name?: string) => {
    setUpdating(name ?? "__all__");
    try {
      await updateSubmodule(name);
      toast.success(t("submodules.submoduleUpdated"), t("submodules.title"));
    } catch (e) {
      toast.error(formatError(e), t("submodules.submoduleFailed"));
    } finally {
      setUpdating(null);
    }
  };

  const handleRemove = async (sm: SubmoduleInfo) => {
    const confirmed = await confirmDialog(
      t("submodules.removeTitle"),
      t("submodules.removeConfirm", { name: sm.name }),
      "warning"
    );
    if (!confirmed) return;
    try {
      await removeSubmodule(sm.name);
      toast.success(
        t("submodules.submoduleRemoved", { name: sm.name }),
        t("submodules.title")
      );
    } catch (e) {
      toast.error(formatError(e), t("submodules.submoduleFailed"));
    }
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case "unchanged":
        return t("submodules.statusUnchanged");
      case "modified":
        return t("submodules.statusModified");
      case "uninitialized":
        return t("submodules.statusUninitialized");
      case "deleted":
        return t("submodules.statusDeleted");
      default:
        return status;
    }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case "modified":
      case "uninitialized":
      case "deleted":
        return "text-warning";
      default:
        return "text-text-muted";
    }
  };

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("branches.openRepoHint")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <PackageIcon size={16} className="text-text-secondary" />
        <span className="text-base font-semibold flex-1">
          {t("submodules.title")}
        </span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-ghost"
          title={t("submodules.addSubmodule")}
          aria-label={t("submodules.addSubmodule")}
        >
          <PlusIcon size={16} />
        </button>
        <button
          onClick={() => handleUpdate()}
          disabled={updating === "__all__" || !submodules || submodules.length === 0}
          className="btn-ghost"
          title={t("submodules.updateAll")}
          aria-label={t("submodules.updateAll")}
        >
          {updating === "__all__" ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
        </button>
        <button
          onClick={() => refreshSubmodules()}
          disabled={refreshing}
          aria-busy={refreshing}
          className="btn-ghost"
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          {refreshing ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="px-3 py-3 border-b border-border space-y-2.5 bg-bg-elevated">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("submodules.urlPlaceholder")}
            className="input text-sm py-1.5"
            autoFocus
          />
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={t("submodules.pathPlaceholder")}
            className="input text-sm py-1.5"
          />
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t("submodules.branchPlaceholder")}
            className="input text-sm py-1.5"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="btn-ghost text-xs"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleAdd}
              disabled={!url.trim() || !path.trim() || saving}
              aria-busy={saving}
              className="btn-primary text-xs"
            >
              {saving ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
              {t("submodules.addSubmodule")}
            </button>
          </div>
        </div>
      )}

      {/* List + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 border-r border-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            {submodules === null ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                <SpinnerIcon size={14} className="mr-2" />
                {t("changes.refresh")}
              </div>
            ) : submodules.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t("submodules.noSubmodules")}
              </div>
            ) : (
              <div className="px-2 py-2 space-y-0.5">
                {submodules.map((sm) => {
                  const isSelected = selected?.name === sm.name;
                  const isUpdating = updating === sm.name;
                  return (
                    <div
                      key={sm.name}
                      className={clsx(
                        "group rounded cursor-pointer border",
                        isSelected
                          ? "bg-bg-hover border-border-strong"
                          : "border-transparent hover:bg-bg-hover"
                      )}
                      onClick={() => setSelected(sm)}
                    >
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        {isSelected ? (
                          <ChevronDownIcon size={12} className="text-text-muted shrink-0" />
                        ) : (
                          <ChevronRightIcon size={12} className="text-text-muted shrink-0" />
                        )}
                        <PackageIcon size={14} className="text-text-secondary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">
                            {sm.name}
                          </div>
                          <div className="text-2xs text-text-muted font-mono">
                            {sm.short_hash} ·{" "}
                            <span className={statusColor(sm.status)}>
                              {statusLabel(sm.status)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div
                        className={clsx(
                          "flex items-center gap-1 px-2.5 pb-2",
                          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdate(sm.name);
                          }}
                          disabled={isUpdating}
                          className="btn-ghost text-2xs px-1.5 py-0.5"
                          title={t("submodules.update")}
                        >
                          {isUpdating ? <SpinnerIcon size={12} /> : <RefreshIcon size={12} />}
                          {t("submodules.update")}
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(sm);
                          }}
                          className="btn-ghost text-2xs px-1.5 py-0.5 text-text-muted hover:text-danger"
                          title={t("submodules.remove")}
                          aria-label={t("submodules.remove")}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
                <PackageIcon size={14} className="text-text-secondary shrink-0" />
                <span className="font-mono text-sm text-text-primary truncate flex-1">
                  {selected.name}
                </span>
                <span className={clsx("text-xs", statusColor(selected.status))}>
                  {statusLabel(selected.status)}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  className="btn-ghost"
                  title={t("changes.dismiss")}
                  aria-label={t("changes.dismiss")}
                >
                  <XIcon size={14} />
                </button>
              </div>

              <div className="px-4 py-3 border-b border-border text-xs space-y-1.5 shrink-0 bg-bg-elevated">
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">name:</span>
                  <span className="text-text-primary truncate flex-1 font-mono">
                    {selected.name}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">path:</span>
                  <span className="text-text-primary truncate flex-1 font-mono">
                    {selected.path}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">HEAD:</span>
                  <span className="font-mono text-text-primary">
                    {selected.short_hash}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">URL:</span>
                  <span className="text-text-primary truncate flex-1 font-mono">
                    {selected.url}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">
                    {t("submodules.title")}:
                  </span>
                  <span className={statusColor(selected.status)}>
                    {statusLabel(selected.status)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-3 border-b border-border shrink-0">
                <button
                  onClick={() => handleUpdate(selected.name)}
                  disabled={updating === selected.name}
                  className="btn-secondary text-xs"
                >
                  {updating === selected.name ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
                  {t("submodules.update")}
                </button>
                <button
                  onClick={() => handleRemove(selected)}
                  className="btn-ghost text-xs text-danger"
                >
                  <TrashIcon size={14} />
                  {t("submodules.remove")}
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4">
                <AlertCircleIcon size={14} className="text-text-muted inline-block mr-2" />
                <span className="text-text-muted text-xs">
                  {t("submodules.title")}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {t("submodules.noSubmodules")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
