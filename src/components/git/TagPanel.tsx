import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import type { TagInfo } from "@/types";
import {
  TagIcon,
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
 * Tag management panel.
 *
 * Lists all tags (annotated + lightweight) sorted by target date desc and
 * exposes create / delete. Creating accepts an optional annotation message;
 * empty message creates a lightweight tag, non-empty creates an annotated tag.
 *
 * Selecting a tag shows its metadata (target commit, tagger, annotation) and
 * the diff of the target commit against its first parent.
 */
export function TagPanel() {
  const { t } = useTranslation();
  const {
    currentPath,
    tags,
    refreshing,
    refreshTags,
    createTag,
    deleteTag,
  } = useRepoStore();
  const toast = useToastStore();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<TagInfo | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    if (currentPath) {
      void refreshTags();
    }
  }, [currentPath, refreshTags]);

  // Reset selection when tag list changes (e.g. after delete).
  useEffect(() => {
    if (selected) {
      const stillExists = tags?.some((t) => t.name === selected.name);
      if (!stillExists) {
        setSelected(null);
        setDiffText("");
        setDiffError(null);
      }
    }
  }, [tags, selected]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createTag(trimmed, message.trim() || undefined);
      toast.success(t("tags.tagCreated", { name: trimmed }));
      setName("");
      setMessage("");
      setShowForm(false);
    } catch (e) {
      toast.error(formatError(e), t("tags.tagCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tag: TagInfo) => {
    const confirmed = await confirmDialog(
      t("tags.deleteTitle"),
      t("tags.deleteConfirm", { name: tag.name }),
      "warning"
    );
    if (!confirmed) return;
    try {
      await deleteTag(tag.name);
      toast.success(t("tags.tagDeleted", { name: tag.name }));
    } catch (e) {
      toast.error(formatError(e), t("tags.tagDeleteFailed"));
    }
  };

  const handleSelect = async (tag: TagInfo) => {
    if (selected?.name === tag.name) {
      setSelected(null);
      setDiffText("");
      setDiffError(null);
      return;
    }
    setSelected(tag);
    setDiffText("");
    setDiffError(null);
    if (!currentPath) return;
    setDiffLoading(true);
    try {
      const diff = await gitService.getCommitDiff(currentPath, tag.target_hash);
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

  // Sort by target date desc.
  const sortedTags = tags
    ? [...tags].sort((a, b) => b.target_date - a.target_date)
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <TagIcon size={16} className="text-text-secondary" />
        <span className="text-base font-semibold flex-1">{t("tags.title")}</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-ghost"
          title={t("tags.newTag")}
          aria-label={t("tags.newTag")}
        >
          <PlusIcon size={16} />
        </button>
        <button
          onClick={() => refreshTags()}
          disabled={refreshing}
          aria-busy={refreshing}
          className="btn-ghost"
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
        >
          {refreshing ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      {/* Tag form */}
      {showForm && (
        <div className="px-3 py-3 border-b border-border space-y-2.5 bg-bg-elevated">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={t("tags.tagNamePlaceholder")}
            className="input text-sm py-1.5"
            autoFocus
          />
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("tags.tagMessagePlaceholder")}
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
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              aria-busy={saving}
              className="btn-primary text-xs"
            >
              {saving ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
              {t("tags.newTag")}
            </button>
          </div>
        </div>
      )}

      {/* Tag list + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 border-r border-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            {sortedTags === null ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs">
                <SpinnerIcon size={14} className="mr-2" />
                {t("changes.refresh")}
              </div>
            ) : sortedTags.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                {t("tags.noTags")}
              </div>
            ) : (
              <div className="px-2 py-2 space-y-0.5">
                {sortedTags.map((tag) => {
                  const isSelected = selected?.name === tag.name;
                  return (
                    <div
                      key={tag.name}
                      className={clsx(
                        "group flex items-center gap-2 px-2.5 py-2 rounded cursor-pointer border",
                        isSelected
                          ? "bg-bg-hover border-border-strong"
                          : "border-transparent hover:bg-bg-hover"
                      )}
                      onClick={() => handleSelect(tag)}
                    >
                      {isSelected ? (
                        <ChevronDownIcon size={12} className="text-text-muted shrink-0" />
                      ) : (
                        <ChevronRightIcon size={12} className="text-text-muted shrink-0" />
                      )}
                      <TagIcon size={14} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary truncate font-mono">
                          {tag.name}
                        </div>
                        <div className="text-2xs text-text-muted">
                          {tag.is_annotated
                            ? t("tags.annotated")
                            : t("tags.lightweight")}{" "}
                          · {tag.short_hash}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(tag);
                        }}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-danger transition-opacity"
                        aria-label={t("tags.deleteAria", { name: tag.name })}
                        title={t("tags.delete")}
                      >
                        <TrashIcon size={14} />
                      </button>
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
                <TagIcon size={14} className="text-text-secondary shrink-0" />
                <span className="font-mono text-sm text-text-primary truncate flex-1">
                  {selected.name}
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

              {/* Metadata */}
              <div className="px-4 py-3 border-b border-border text-xs space-y-1.5 shrink-0 bg-bg-elevated">
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">
                    {t("tags.targetCommit")}:
                  </span>
                  <span className="font-mono text-text-primary">
                    {selected.short_hash}
                  </span>
                </div>
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">
                    {t("branches.history")}:
                  </span>
                  <span className="text-text-primary truncate flex-1">
                    {selected.target_message}
                  </span>
                </div>
                {selected.is_annotated && (
                  <>
                    {selected.tagger && (
                      <div className="flex">
                        <span className="text-text-muted w-20 shrink-0">
                          {t("tags.tagger")}:
                        </span>
                        <span className="text-text-primary truncate">
                          {selected.tagger}
                        </span>
                      </div>
                    )}
                    {selected.annotation && (
                      <div className="flex">
                        <span className="text-text-muted w-20 shrink-0">
                          {t("tags.annotated")}:
                        </span>
                        <span className="text-text-primary whitespace-pre-wrap flex-1">
                          {selected.annotation}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex">
                  <span className="text-text-muted w-20 shrink-0">
                    {t("branches.history")}:
                  </span>
                  <span className="text-text-secondary">
                    {new Date(selected.target_date * 1000).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Diff */}
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
                    {t("branches.loadingDiff")}
                  </div>
                )}
                {!diffLoading && !diffError && diffText && (
                  <pre className="font-mono text-xs text-text-primary p-4 whitespace-pre-wrap break-all leading-relaxed select-text">
                    {colorizePatch(diffText)}
                  </pre>
                )}
                {!diffLoading && !diffError && !diffText && (
                  <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                    {t("branches.noDiff")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {t("tags.noTags")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
