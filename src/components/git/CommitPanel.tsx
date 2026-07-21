import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import {
  CheckIcon,
  PlusIcon,
  MinusIcon,
  AlertCircleIcon,
  SendIcon,
  DownloadIcon,
  SpinnerIcon,
} from "@/components/common/Icons";

export function CommitPanel() {
  const { t } = useTranslation();

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
    committing,
    commitAndPushing,
    pushError,
    aiError,
    aiLoading,
    commitMessage: message,
    setCommitMessage: setMessage,
    setCommitting,
    setCommitAndPushing,
    setPushError,
    setAiError,
    setAiLoading,
  } = useRepoStore();
  const { generateCommitMessage } = useAiStore();
  const { config } = useSettingsStore();
  const toast = useToastStore();

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
    setAiError(null);
    setAiLoading(true);
    try {
      const msg = await generateCommitMessage(currentPath, config);
      setMessage(msg);
      toast.success(t("commit.aiGenerated"));
    } catch (e) {
      // aiStore sets its own global error; mirror it onto the active tab
      // so the inline panel can display the message.
      console.error("[aigit] AI Generate failed in panel:", e);
      const msg = formatError(e);
      setAiError(msg);
      toast.error(msg, t("commit.aiGenerateFailed"));
    } finally {
      setAiLoading(false);
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
      toast.success(t("commit.commitSuccess"));
    } catch (e) {
      const msg = formatError(e);
      console.error("[aigit] commit failed:", e);
      toast.error(msg, t("commit.commitFailed"));
    } finally {
      setCommitting(false);
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
      try {
        await push(true);
        const body = branch
          ? t("commit.pushSuccessBody", { branch })
          : t("commit.pushSuccessBodyGeneric");
        toast.success(body, t("commit.pushSuccessTitle"));
      } catch (e) {
        const msg = formatError(e);
        setPushError(msg);
        toast.error(msg, t("commit.pushFailed"));
      }
      await refreshStatus();
    } catch (e) {
      // commit failed (push was not attempted)
      const msg = formatError(e);
      console.error("[aigit] commit&push failed at commit stage:", e);
      toast.error(msg, t("commit.commitFailed"));
    } finally {
      setCommitAndPushing(false);
    }
  };

  const handlePushOnly = async () => {
    setPushError(null);
    try {
      await push(true);
      const body = branch
        ? t("commit.pushSuccessBody", { branch })
        : t("commit.pushSuccessBodyGeneric");
      toast.success(body, t("commit.pushSuccessTitle"));
    } catch (e) {
      const msg = formatError(e);
      setPushError(msg);
      toast.error(msg, t("commit.pushFailed"));
    }
  };

  const handlePull = async () => {
    setPushError(null);
    try {
      await pull();
      toast.success(t("commit.pullSuccessBody"), t("commit.pullSuccessTitle"));
    } catch (e) {
      const msg = formatError(e);
      setPushError(msg);
      toast.error(msg, t("commit.pullFailed"));
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
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <button
          onClick={stageAll}
          className="btn-ghost text-xs"
          title={t("commit.stageAll")}
        >
          <PlusIcon size={14} /> {t("commit.stageAll")}
        </button>
        <button
          onClick={handleUnstageAll}
          className="btn-ghost text-xs"
          title={t("commit.unstageAll")}
        >
          <MinusIcon size={14} /> {t("commit.unstageAll")}
        </button>
      </div>

      {/* AI error display (inline so users keep context while writing the message) */}
      {aiError && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-danger/10 text-danger text-xs border-b border-danger/20">
          <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{aiError}</span>
          <button onClick={() => setAiError(null)} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Push/Pull error display (kept inline so users can read full git stderr) */}
      {pushError && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-danger/10 text-danger text-xs border-b border-danger/20">
          <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words whitespace-pre-wrap">{pushError}</span>
          <button onClick={() => setPushError(null)} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}

      {/* Debug status bar - shows why button might be disabled */}
      {!currentPath && (
        <div className="px-4 py-2 text-xs text-text-muted bg-bg-elevated border-b border-border">
          {t("changes.noRepoTitle")}
        </div>
      )}
      {currentPath && !hasChanges && (
        <div className="px-4 py-2 text-xs text-text-muted bg-bg-elevated border-b border-border">
          {t("fileList.noChanges")}
        </div>
      )}

      {/* Commit message */}
      <div className="flex-1 p-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleMessageKeyDown}
          placeholder={t("commit.messagePlaceholder") + t("commit.messageShortcutHint")}
          className="w-full h-full bg-bg-base border border-border rounded p-3.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong resize-none"
          spellCheck={false}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-4 border-t border-border">
        <button
          onClick={handleAiGenerate}
          disabled={!currentPath || aiLoading}
          className="btn-ghost"
        >
          {aiLoading ? <SpinnerIcon size={14} /> : <PlusIcon size={14} />}
          {aiLoading ? t("commit.generating") : t("commit.aiGenerate")}
        </button>
        <div className="flex-1" />
        {behind > 0 && (
          <span className="text-xs text-danger" title={t("commit.behindHint", { count: behind })}>
            ↓{behind}
          </span>
        )}
        {ahead > 0 && (
          <span className="text-xs text-accent" title={t("commit.aheadHint", { count: ahead })}>
            ↑{ahead}
          </span>
        )}
        <span className="text-xs text-text-muted">
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
            {pulling ? <SpinnerIcon size={14} /> : <DownloadIcon size={14} />}
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
            {pushing ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
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
          {commitAndPushing ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
          {commitAndPushing ? t("commit.committingAndPushing") : t("commit.commitAndPush")}
        </button>
        {/* Commit-only button */}
        <button
          onClick={handleCommit}
          disabled={!message.trim() || busy || !hasChanges}
          className="btn-primary"
          title={t("commit.commitShortcut")}
        >
          {committing ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
          {committing ? t("commit.committing") : t("commit.commit")}
        </button>
      </div>
    </div>
  );
}
