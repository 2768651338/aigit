import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { formatError } from "@/utils/error";
import { showMessage } from "@/utils/dialog";
import {
  SparklesIcon,
  CheckIcon,
  PlusIcon,
  MinusIcon,
  AlertCircleIcon,
  SendIcon,
  DownloadIcon,
} from "@/components/common/Icons";
import clsx from "clsx";

export function CommitPanel() {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitAndPushing, setCommitAndPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const {
    currentPath,
    fileStatuses,
    stageAll,
    unstageFiles,
    commit,
    push,
    pull,
    refreshStatus,
    repoInfo,
    pushing,
    pulling,
  } = useRepoStore();
  const { generateCommitMessage, loading: aiLoading, error: aiError, clearError: clearAiError } = useAiStore();
  const { config } = useSettingsStore();

  const stagedCount = fileStatuses.filter((f) => f.staged).length;
  const hasChanges = fileStatuses.length > 0;
  const ahead = repoInfo?.ahead ?? 0;
  const behind = repoInfo?.behind ?? 0;
  const branch = repoInfo?.current_branch ?? "";

  const handleAiGenerate = async () => {
    if (!currentPath) {
      console.warn("[aigit] AI Generate clicked but no repository open");
      return;
    }
    if (!config) {
      console.warn("[aigit] AI Generate clicked but no config loaded");
      return;
    }
    clearAiError();
    try {
      const msg = await generateCommitMessage(currentPath, config);
      setMessage(msg);
    } catch (e) {
      console.error("[aigit] AI Generate failed in panel:", e);
    }
  };

  // If there are working-directory changes but nothing is staged yet,
  // auto-stage all so the user can commit without manual staging.
  const ensureStaged = async () => {
    if (stagedCount === 0 && hasChanges) {
      await stageAll();
    }
  };

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await ensureStaged();
      await commit(message);
      setMessage("");
      await refreshStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setCommitting(false);
    }
  };

  // Runs push and reports the outcome via a native modal dialog.
  // Returns true on success, false on failure.
  const runPushWithDialog = async (): Promise<boolean> => {
    setPushError(null);
    try {
      await push(true);
      const body = branch
        ? t("commit.pushSuccessBody", { branch })
        : t("commit.pushSuccessBodyGeneric");
      await showMessage(t("commit.pushSuccessTitle"), body, "success");
      return true;
    } catch (e) {
      const msg = formatError(e);
      setPushError(msg);
      return false;
    }
  };

  const handleCommitAndPush = async () => {
    if (!message.trim()) return;
    setCommitAndPushing(true);
    setPushError(null);
    try {
      await ensureStaged();
      await commit(message);
      setMessage("");
      // Push after a successful commit. If upstream is not configured,
      // pass set_upstream=true so the branch tracks origin on first push.
      await runPushWithDialog();
      await refreshStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setCommitAndPushing(false);
    }
  };

  const handlePushOnly = async () => {
    await runPushWithDialog();
  };

  const handlePull = async () => {
    setPushError(null);
    try {
      await pull();
      await showMessage(
        t("commit.pullSuccessTitle"),
        t("commit.pullSuccessBody"),
        "success"
      );
    } catch (e) {
      setPushError(formatError(e));
    }
  };

  const handleUnstageAll = () => {
    const stagedFiles = fileStatuses.filter((f) => f.staged).map((f) => f.path);
    if (stagedFiles.length > 0) {
      unstageFiles(stagedFiles);
    }
  };

  // Ctrl/Cmd+Enter inside the commit message textarea triggers commit.
  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (message.trim() && !busy && hasChanges) {
        handleCommit();
      }
    }
  };

  const busy = committing || commitAndPushing || pushing || pulling;

  return (
    <div className="flex flex-col h-full">
      {/* Stage controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          onClick={stageAll}
          className="btn-ghost text-2xs"
          title={t("commit.stageAll")}
        >
          <PlusIcon size={12} /> {t("commit.stageAll")}
        </button>
        <button
          onClick={handleUnstageAll}
          className="btn-ghost text-2xs"
          title={t("commit.unstageAll")}
        >
          <MinusIcon size={12} /> {t("commit.unstageAll")}
        </button>
      </div>

      {/* AI error display */}
      {aiError && (
        <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 text-danger text-2xs border-b border-danger/20">
          <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{aiError}</span>
          <button onClick={clearAiError} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Push/Pull error display (kept inline so users can read full git stderr) */}
      {pushError && (
        <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 text-danger text-2xs border-b border-danger/20">
          <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words whitespace-pre-wrap">{pushError}</span>
          <button onClick={() => setPushError(null)} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Debug status bar - shows why button might be disabled */}
      {!currentPath && (
        <div className="px-3 py-1.5 text-2xs text-text-muted bg-bg-elevated border-b border-border">
          {t("changes.noRepoTitle")}
        </div>
      )}
      {currentPath && !hasChanges && (
        <div className="px-3 py-1.5 text-2xs text-text-muted bg-bg-elevated border-b border-border">
          {t("fileList.noChanges")}
        </div>
      )}

      {/* Commit message */}
      <div className="flex-1 p-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleMessageKeyDown}
          placeholder={t("commit.messagePlaceholder") + t("commit.messageShortcutHint")}
          className="w-full h-full bg-bg-base border border-border rounded p-3 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none"
          spellCheck={false}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-3 border-t border-border">
        <button
          onClick={handleAiGenerate}
          disabled={!currentPath || aiLoading}
          className={clsx(
            "btn-secondary",
            "border-accent/30 text-accent hover:bg-accent-glow"
          )}
        >
          <SparklesIcon size={14} />
          {aiLoading ? t("commit.generating") : t("commit.aiGenerate")}
        </button>
        <div className="flex-1" />
        {behind > 0 && (
          <span className="text-2xs text-danger" title={t("commit.behindHint", { count: behind })}>
            ↓{behind}
          </span>
        )}
        {ahead > 0 && (
          <span className="text-2xs text-accent" title={t("commit.aheadHint", { count: ahead })}>
            ↑{ahead}
          </span>
        )}
        <span className="text-2xs text-text-muted">
          {t("commit.stagedCount", { count: stagedCount })}
        </span>
        {/* Pull button - visible when there are upstream commits to fetch */}
        {behind > 0 && (
          <button
            onClick={handlePull}
            disabled={busy}
            className="btn-secondary"
            title={t("commit.pull")}
          >
            <DownloadIcon size={14} />
            {pulling ? t("commit.pulling") : t("commit.pull")}
          </button>
        )}
        {/* Push-only button (visible when there are unpushed commits) */}
        {ahead > 0 && (
          <button
            onClick={handlePushOnly}
            disabled={busy}
            className="btn-secondary"
            title={t("commit.push")}
          >
            <SendIcon size={14} />
            {pushing ? t("commit.pushing") : t("commit.push")}
          </button>
        )}
        {/* Commit & Push button */}
        <button
          onClick={handleCommitAndPush}
          disabled={!message.trim() || busy || !hasChanges}
          className="btn-secondary"
          title={t("commit.commitAndPush")}
        >
          <SendIcon size={14} />
          {commitAndPushing ? t("commit.committingAndPushing") : t("commit.commitAndPush")}
        </button>
        {/* Commit-only button */}
        <button
          onClick={handleCommit}
          disabled={!message.trim() || busy || !hasChanges}
          className="btn-primary"
          title={t("commit.commitShortcut")}
        >
          <CheckIcon size={14} />
          {committing ? t("commit.committing") : t("commit.commit")}
        </button>
      </div>
    </div>
  );
}
