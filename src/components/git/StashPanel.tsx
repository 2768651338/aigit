import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { StashInfo } from "@/types";
import {
  ArchiveIcon,
  RefreshIcon,
  PlusIcon,
  CheckIcon,
  TrashIcon,
  DownloadIcon,
  AlertCircleIcon,
  SpinnerIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

/**
 * Stash management panel.
 *
 * Lists all `stash@{n}` entries and exposes the four canonical operations:
 * save (push), apply, pop, drop. A "stash all" form at the top lets the user
 * capture the current working-tree state with an optional message and the
 * `--include-untracked` / `--keep-index` flags.
 *
 * Selecting a stash expands an inline diff preview (fetched via the existing
 * `get_commit_diff` command — a stash is just a commit).
 */
export function StashPanel() {
  const { t } = useTranslation();
  const {
    currentPath,
    stashes,
    refreshing,
    refreshStashes,
    stashSave,
    stashApply,
    stashPop,
    stashDrop,
  } = useRepoStore();
  const toast = useToastStore();

  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<StashInfo | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Load stash list on mount.
  useEffect(() => {
    if (currentPath) {
      void refreshStashes();
    }
  }, [currentPath, refreshStashes]);

  // Reset selection when stash list changes (e.g. after pop/drop).
  useEffect(() => {
    if (selected) {
      const stillExists = stashes?.some((s) => s.index === selected.index);
      if (!stillExists) {
        setSelected(null);
        setDiffText("");
        setDiffError(null);
      }
    }
  }, [stashes, selected]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await stashSave(
        message.trim() || undefined,
        includeUntracked,
        keepIndex
      );
      toast.success(t("stashes.stashCreated"));
      setMessage("");
      setIncludeUntracked(false);
      setKeepIndex(false);
      setShowForm(false);
    } catch (e) {
      toast.error(formatError(e), t("stashes.stashFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (s: StashInfo) => {
    try {
      await stashApply(s.index);
      toast.success(t("stashes.stashApplied", { index: s.index }));
    } catch (e) {
      toast.error(formatError(e), t("stashes.stashFailed"));
    }
  };

  const handlePop = async (s: StashInfo) => {
    try {
      await stashPop(s.index);
      toast.success(t("stashes.stashPopped", { index: s.index }));
    } catch (e) {
      toast.error(formatError(e), t("stashes.stashFailed"));
    }
  };

  const handleDrop = async (s: StashInfo) => {
    const confirmed = await confirmDialog(
      t("stashes.dropTitle"),
      t("stashes.dropConfirm", { index: s.index }),
      "warning"
    );
    if (!confirmed) return;
    try {
      await stashDrop(s.index);
      toast.success(t("stashes.stashDropped", { index: s.index }));
    } catch (e) {
      toast.error(formatError(e), t("stashes.stashFailed"));
    }
  };

  const handleSelect = async (s: StashInfo) => {
    if (selected?.index === s.index) {
      setSelected(null);
      setDiffText("");
      setDiffError(null);
      return;
    }
    setSelected(s);
    setDiffText("");
    setDiffError(null);
    if (!currentPath) return;
    setDiffLoading(true);
    try {
      // A stash is a commit — its hash can be passed to get_commit_diff.
      const diff = await gitService.getCommitDiff(currentPath, s.hash);
      setDiffText(diff);
    } catch (e) {
      setDiffError(formatError(e));
    } finally {
      setDiffLoading(false);
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
        <ArchiveIcon size={16} className="text-text-secondary" />
        <span className="text-base font-semibold flex-1">{t("stashes.title")}</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-ghost"
          title={t("stashes.stashAll")}
          aria-label={t("stashes.stashAll")}
        >
          <PlusIcon size={16} />
        </button>
        <button
          onClick={() => refreshStashes()}
          disabled={refreshing}
          aria-busy={refreshing}
          className="btn-ghost"
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          {refreshing ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      {/* Stash form */}
      {showForm && (
        <div className="px-3 py-3 border-b border-border space-y-2.5 bg-bg-elevated">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("stashes.stashMessagePlaceholder")}
            className="input text-sm py-1.5"
            autoFocus
          />
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(e) => setIncludeUntracked(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-text-secondary">
                {t("stashes.includeUntracked")}
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={keepIndex}
                onChange={(e) => setKeepIndex(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-text-secondary">{t("stashes.keepIndex")}</span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="btn-ghost text-xs"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="btn-primary text-xs"
            >
              {saving ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
              {t("stashes.stashAll")}
            </button>
          </div>
        </div>
      )}

      {/* Stash list + diff preview */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 border-r border-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            {stashes === null ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                <SpinnerIcon size={14} className="mr-2" />
                {t("changes.refresh")}
              </div>
            ) : stashes.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t("stashes.noStashes")}
              </div>
            ) : (
              <div className="px-2 py-2 space-y-0.5">
                {stashes.map((s) => {
                  const isSelected = selected?.index === s.index;
                  return (
                    <div
                      key={s.index}
                      className={clsx(
                        "group rounded cursor-pointer border",
                        isSelected
                          ? "bg-bg-hover border-border-strong"
                          : "border-transparent hover:bg-bg-hover"
                      )}
                      onClick={() => handleSelect(s)}
                    >
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        {isSelected ? (
                          <ChevronDownIcon size={12} className="text-text-muted shrink-0" />
                        ) : (
                          <ChevronRightIcon size={12} className="text-text-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">
                            {s.message || `stash@{${s.index}}`}
                          </div>
                          <div className="text-2xs text-text-muted font-mono">
                            {s.short_hash} · {formatDate(s.date)}
                          </div>
                        </div>
                      </div>
                      {/* Inline action row — visible on hover or when selected. */}
                      <div
                        className={clsx(
                          "flex items-center gap-1 px-2.5 pb-2",
                          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApply(s);
                          }}
                          className="btn-ghost text-2xs px-1.5 py-0.5"
                          title={t("stashes.apply")}
                        >
                          <DownloadIcon size={12} />
                          {t("stashes.apply")}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePop(s);
                          }}
                          className="btn-ghost text-2xs px-1.5 py-0.5"
                          title={t("stashes.pop")}
                        >
                          <CheckIcon size={12} />
                          {t("stashes.pop")}
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDrop(s);
                          }}
                          className="btn-ghost text-2xs px-1.5 py-0.5 text-text-muted hover:text-danger"
                          title={t("stashes.drop")}
                          aria-label={t("stashes.drop")}
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

        {/* Diff preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
                <span className="font-mono text-xs text-text-muted">
                  {`stash@{${selected.index}}`}
                </span>
                <span className="text-sm text-text-primary truncate flex-1">
                  {selected.message || `stash@{${selected.index}}`}
                </span>
                <button
                  onClick={() => {
                    setSelected(null);
                    setDiffText("");
                    setDiffError(null);
                  }}
                  className="btn-ghost"
                  title={t("changes.dismiss")}
                  aria-label={t("changes.dismiss")}
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {diffError && (
                  <div className="flex items-start gap-2 p-3.5 m-3 bg-danger/10 text-danger text-sm rounded border border-danger/20">
                    <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
                    <span className="flex-1 break-words whitespace-pre-wrap">{diffError}</span>
                  </div>
                )}
                {diffLoading && (
                  <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
                    <SpinnerIcon size={14} />
                    {t("stashes.loadingDiff")}
                  </div>
                )}
                {!diffLoading && !diffError && diffText && (
                  <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre-wrap break-all leading-relaxed select-text">
                    {colorizePatch(diffText)}
                  </pre>
                )}
                {!diffLoading && !diffError && !diffText && (
                  <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                    {t("stashes.noDiff")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {t("stashes.noStashes")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Render a unified-diff patch string with line-level coloring. */
function colorizePatch(patch: string): React.ReactNode[] {
  return patch.split("\n").map((line, i) => {
    let className = "text-text-secondary";
    if (line.startsWith("+++") || line.startsWith("---")) {
      className = "text-text-primary font-semibold";
    } else if (line.startsWith("@@")) {
      className = "text-info";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "text-success";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "text-danger";
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      className = "text-info font-semibold";
    }
    return (
      <div key={i} className={className}>
        {line || " "}
      </div>
    );
  });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString();
}
