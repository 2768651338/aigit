import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { gitService } from "@/services/git";
import { aiService } from "@/services/ai";
import type { GitErrorAnalysis } from "@/types";
import {
  CheckIcon,
  PlusIcon,
  MinusIcon,
  AlertCircleIcon,
  SendIcon,
  DownloadIcon,
  SpinnerIcon,
  HistoryIcon,
  ChevronDownIcon,
  XIcon,
} from "@/components/common/Icons";

/** localStorage key prefix for per-repo commit message history. */
const HISTORY_KEY = "aigit:commitHistory:";
const HISTORY_MAX = 20;

/** Conventional Commits prefixes shown as quick-insert chips. */
const COMMIT_PREFIXES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore"] as const;

function loadHistory(repoPath: string): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY + repoPath);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(repoPath: string, messages: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY + repoPath, JSON.stringify(messages.slice(0, HISTORY_MAX)));
  } catch {
    // best-effort — ignore quota errors
  }
}

export function CommitPanel({ onSmartCommit }: { onSmartCommit?: () => void }) {
  const { t } = useTranslation();

  const {
    currentPath,
    fileStatuses,
    stageAll,
    unstageFiles,
    commit,
    amend,
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
    commitMessage: message,
    setCommitMessage: setMessage,
    setCommitting,
    setCommitAndPushing,
    setPushError,
    setAiError,
    setCommitMessageFor,
    setAiErrorFor,
    setAiLoadingFor,
  } = useRepoStore();
  const { generateCommitMessage, cancelTask } = useAiStore();
  const aiRequestActive = useAiStore((s) => currentPath ? Boolean(s.activeRequestByScope[`${currentPath}\u0000commit`]) : false);
  const { config } = useSettingsStore();
  const toast = useToastStore();

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [amendMode, setAmendMode] = useState(false);
  const [includeStagedInAmend, setIncludeStagedInAmend] = useState(false);
  // AI analysis of a failed push — transient UI state scoped to the panel.
  const [pushAnalysis, setPushAnalysis] = useState<GitErrorAnalysis | null>(null);
  const [pushAnalyzing, setPushAnalyzing] = useState(false);
  const [pushAnalyzeFailed, setPushAnalyzeFailed] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the push analysis whenever the repo or the push error changes so
  // stale advice never lingers after a different failure.
  useEffect(() => {
    setPushAnalysis(null);
    setPushAnalyzeFailed(null);
  }, [currentPath, pushError]);

  // Load history when the active repo changes.
  useEffect(() => {
    if (currentPath) {
      setHistory(loadHistory(currentPath));
    } else {
      setHistory([]);
    }
    setShowHistory(false);
  }, [currentPath]);

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
    // Snapshot the originating repo so that if the user switches tabs while the
    // generation is in flight, the result (and the loading/error state) still
    // land on this repo rather than whichever repo is now active. This mirrors
    // the per-repo isolation already used by code review and repo chat.
    const targetPath = currentPath;
    setAiErrorFor(targetPath, null);
    setAiLoadingFor(targetPath, true);
    try {
      const msg = await generateCommitMessage(targetPath);
      setCommitMessageFor(targetPath, msg);
      toast.success(t("commit.aiGenerated"));
    } catch (e) {
      // aiStore sets its own global error; mirror it onto the originating tab
      // so the inline panel can display the message when the user returns to it.
      console.error("[aigit] AI Generate failed in panel:", e);
      const msg = formatError(e);
      setAiErrorFor(targetPath, msg);
      toast.error(msg, t("commit.aiGenerateFailed"));
    } finally {
      setAiLoadingFor(targetPath, false);
    }
  };

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      if (amendMode) {
        let confirmPushed = false;
        if (currentPath && await gitService.isHeadPushed(currentPath)) {
          confirmPushed = window.confirm(t("commit.amendPushedConfirm"));
          if (!confirmPushed) return;
        }
        await amend(message, includeStagedInAmend, confirmPushed);
      } else {
        if (stagedCount === 0) throw new Error(t("commit.explicitStageRequired"));
        await commit(message);
      }
      // Persist this message into per-repo history (deduped, most-recent first).
      if (currentPath) {
        const next = [message, ...history.filter((m) => m !== message)].slice(0, HISTORY_MAX);
        setHistory(next);
        saveHistory(currentPath, next);
      }
      setMessage("");
      setAmendMode(false);
      setIncludeStagedInAmend(false);
      // commit()/amend() already refresh status and log internally.
      toast.success(t(amendMode ? "commit.amendSuccess" : "commit.commitSuccess"));
    } catch (e) {
      const msg = formatError(e);
      console.error("[aigit] commit failed:", e);
      toast.error(msg, t(amendMode ? "commit.amendFailed" : "commit.commitFailed"));
    } finally {
      setCommitting(false);
    }
  };

  const handleCommitAndPush = async () => {
    if (!message.trim()) return;
    setCommitAndPushing(true);
    setPushError(null);
    try {
      if (stagedCount === 0) throw new Error(t("commit.explicitStageRequired"));
      await commit(message);
      // Persist this message into per-repo history (deduped, most-recent first).
      if (currentPath) {
        const next = [message, ...history.filter((m) => m !== message)].slice(0, HISTORY_MAX);
        setHistory(next);
        saveHistory(currentPath, next);
      }
      setMessage("");
      // Push only to the branch's configured upstream. Branches without an
      // upstream are configured explicitly from the Remotes panel.
      try {
        await push();
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
      await push();
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

  // Ask the AI to explain the failed push and suggest next steps. The raw git
  // error stays on screen; this only adds advice on top of it.
  const handleAnalyzePushError = async () => {
    if (!currentPath || !pushError || !config) return;
    setPushAnalyzing(true);
    setPushAnalyzeFailed(null);
    try {
      const result = await aiService.analyzeGitError(currentPath, pushError);
      setPushAnalysis(result);
    } catch (e) {
      const msg = formatError(e);
      setPushAnalyzeFailed(msg);
      toast.error(msg, t("commit.analyzeErrorFailed"));
    } finally {
      setPushAnalyzing(false);
    }
  };

  const handleUnstageAll = () => {
    const stagedFiles = fileStatuses.filter((f) => f.staged).map((f) => f.path);
    if (stagedFiles.length > 0) {
      unstageFiles(stagedFiles);
    }
  };

  // Insert a Conventional Commits prefix at the start of the message,
  // unless the message already starts with a prefix.
  const handlePrefixInsert = (prefix: string) => {
    const tag = `${prefix}: `;
    if (message.startsWith(tag)) return;
    // Strip any existing prefix before adding the new one.
    const stripped = COMMIT_PREFIXES.some((p) => message.startsWith(`${p}: `))
      ? message.replace(/^(feat|fix|docs|style|refactor|perf|test|chore):\s*/, "")
      : message;
    setMessage(tag + stripped);
    textareaRef.current?.focus();
  };

  const handlePickHistory = (msg: string) => {
    setMessage(msg);
    setShowHistory(false);
    textareaRef.current?.focus();
  };

  // Ctrl/Cmd+Enter inside the commit message textarea triggers commit.
  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (message.trim() && !busy && (amendMode || hasChanges)) {
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
          onClick={onSmartCommit}
          disabled={!currentPath}
          className="btn-secondary text-xs"
          title={t("smartCommit.open")}
        >
          {t("smartCommit.open")}
        </button>
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
          <span className="flex-1 break-words whitespace-pre-wrap">{pushError}</span>
          <button
            onClick={handleAnalyzePushError}
            disabled={!config || pushAnalyzing || busy}
            aria-busy={pushAnalyzing}
            className="shrink-0 btn-ghost text-2xs"
            title={t("commit.analyzeError")}
          >
            {pushAnalyzing ? <SpinnerIcon size={12} className="animate-spin" /> : <PlusIcon size={12} />}
            {pushAnalyzing ? t("commit.analyzingError") : t("commit.analyzeError")}
          </button>
          <button onClick={() => setPushError(null)} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}
      {pushAnalyzeFailed && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-danger/10 text-danger text-xs border-b border-danger/20">
          <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{pushAnalyzeFailed}</span>
          <button onClick={() => setPushAnalyzeFailed(null)} className="shrink-0 hover:underline">
            {t("changes.dismiss")}
          </button>
        </div>
      )}
      {pushAnalysis && (
        <div className="flex flex-col gap-2 px-4 py-2.5 bg-bg-elevated text-xs border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{t("commit.analyzeResult")}</span>
            <div className="flex-1" />
            {pushAnalysis.safe_action === "pull" && currentPath && (
              <button
                onClick={handlePull}
                disabled={busy}
                aria-busy={pulling}
                className="btn-secondary text-2xs"
              >
                {pulling ? <SpinnerIcon size={12} /> : <DownloadIcon size={12} />}
                {pulling ? t("commit.pulling") : t("commit.pullMerge")}
              </button>
            )}
            <button onClick={() => setPushAnalysis(null)} className="shrink-0 hover:underline">
              {t("changes.dismiss")}
            </button>
          </div>
          <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">
            {pushAnalysis.analysis}
          </p>
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
      <div className="flex-1 p-4 flex flex-col gap-2 min-h-0">
        {/* Conventional Commits prefix chips + history toggle */}
        <div className="flex items-center gap-1 flex-wrap">
          {COMMIT_PREFIXES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handlePrefixInsert(p)}
              className="text-2xs px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors font-mono"
              title={`${p}:`}
            >
              {p}
            </button>
          ))}
          <div className="flex-1" />
          {history.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="btn-ghost text-2xs"
                title={t("commit.history")}
                aria-label={t("commit.history")}
              >
                <HistoryIcon size={13} />
                <ChevronDownIcon size={12} />
              </button>
              {showHistory && (
                <div className="absolute right-0 bottom-full mb-1 w-80 max-h-60 overflow-auto bg-bg-elevated border border-border rounded-md shadow-lg z-20">
                  <div className="px-3 py-1.5 text-2xs text-text-muted border-b border-border">
                    {t("commit.history")}
                  </div>
                  {history.map((msg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handlePickHistory(msg)}
                      className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary truncate"
                      title={msg}
                    >
                      {msg.split("\n")[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Amend controls */}
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={amendMode}
              onChange={(e) => {
                setAmendMode(e.target.checked);
                if (!e.target.checked) setIncludeStagedInAmend(false);
              }}
              disabled={!repoInfo?.head_hash || busy}
            />
            {t("commit.amendMode")}
          </label>
          {amendMode && (
            <label className="flex items-center gap-2 text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeStagedInAmend}
                onChange={(e) => setIncludeStagedInAmend(e.target.checked)}
                disabled={busy || stagedCount === 0}
              />
              {t("commit.includeStaged")}
            </label>
          )}
        </div>
        {amendMode && (
          <div className="flex items-start gap-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
            <span>{t("commit.amendWarning")}</span>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleMessageKeyDown}
          placeholder={t("commit.messagePlaceholder") + t("commit.messageShortcutHint")}
          className="flex-1 w-full bg-bg-base border border-border rounded p-3.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong resize-none"
          spellCheck={false}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-4 border-t border-border">
        <button
          onClick={() => aiRequestActive && currentPath ? void cancelTask(currentPath, "commit") : void handleAiGenerate()}
          disabled={!currentPath}
          aria-busy={aiRequestActive}
          className={aiRequestActive ? "btn-secondary" : "btn-ghost"}
        >
          {aiRequestActive ? <XIcon size={14} /> : <PlusIcon size={14} />}
          {aiRequestActive ? t("commit.stopGenerating") : t("commit.aiGenerate")}
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
            aria-busy={pulling}
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
            aria-busy={pushing}
            className="btn-secondary"
            title={t("commit.push")}
          >
            {pushing ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
            {pushing ? t("commit.pushing") : t("commit.push")}
          </button>
        )}
        {/* Commit & Push button */}
        {!amendMode && (
          <button
            onClick={handleCommitAndPush}
            disabled={!message.trim() || busy || !hasChanges}
            aria-busy={commitAndPushing}
            className="btn-secondary"
            title={t("commit.commitAndPush")}
          >
            {commitAndPushing ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
            {commitAndPushing ? t("commit.committingAndPushing") : t("commit.commitAndPush")}
          </button>
        )}
        {/* Commit-only button */}
        <button
          onClick={handleCommit}
          disabled={!message.trim() || busy || (!amendMode && !hasChanges)}
          aria-busy={committing}
          className="btn-primary"
          title={t(amendMode ? "commit.amend" : "commit.commitShortcut")}
        >
          {committing ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
          {committing ? t("commit.committing") : t(amendMode ? "commit.amend" : "commit.commit")}
        </button>
      </div>
    </div>
  );
}
