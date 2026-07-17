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
    refreshStatus,
    repoInfo,
    pushing,
  } = useRepoStore();
  const { generateCommitMessage, loading: aiLoading, error: aiError, clearError: clearAiError } = useAiStore();
  const { config } = useSettingsStore();

  const stagedCount = fileStatuses.filter((f) => f.staged).length;
  const ahead = repoInfo?.ahead ?? 0;
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

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
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

  const handleUnstageAll = () => {
    const stagedFiles = fileStatuses.filter((f) => f.staged).map((f) => f.path);
    if (stagedFiles.length > 0) {
      unstageFiles(stagedFiles);
    }
  };

  const busy = committing || commitAndPushing || pushing;

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

      {/* Push error display (kept inline so users can read full git stderr) */}
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
      {currentPath && stagedCount === 0 && (
        <div className="px-3 py-1.5 text-2xs text-text-muted bg-bg-elevated border-b border-border">
          {t("fileList.noStaged")} — {t("commit.stageAll")} →
        </div>
      )}

      {/* Commit message */}
      <div className="flex-1 p-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("commit.messagePlaceholder")}
          className="w-full h-full bg-bg-base border border-border rounded p-3 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none"
          spellCheck={false}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-3 border-t border-border">
        <button
          onClick={handleAiGenerate}
          disabled={!currentPath || aiLoading || stagedCount === 0}
          className={clsx(
            "btn-secondary",
            "border-accent/30 text-accent hover:bg-accent-glow"
          )}
        >
          <SparklesIcon size={14} />
          {aiLoading ? t("commit.generating") : t("commit.aiGenerate")}
        </button>
        <div className="flex-1" />
        {ahead > 0 && (
          <span className="text-2xs text-accent" title={t("commit.aheadHint", { count: ahead })}>
            ↑{ahead}
          </span>
        )}
        <span className="text-2xs text-text-muted">
          {t("commit.stagedCount", { count: stagedCount })}
        </span>
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
          disabled={!message.trim() || busy || stagedCount === 0}
          className="btn-secondary"
          title={t("commit.commitAndPush")}
        >
          <SendIcon size={14} />
          {commitAndPushing ? t("commit.committingAndPushing") : t("commit.commitAndPush")}
        </button>
        {/* Commit-only button */}
        <button
          onClick={handleCommit}
          disabled={!message.trim() || busy || stagedCount === 0}
          className="btn-primary"
        >
          <CheckIcon size={14} />
          {committing ? t("commit.committing") : t("commit.commit")}
        </button>
      </div>
    </div>
  );
}
