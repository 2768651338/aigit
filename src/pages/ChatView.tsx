import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore, estimateTokens, isSensitivePath, LARGE_CONTEXT_TOKENS } from "@/stores/aiStore";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { InputDialog } from "@/components/common/InputDialog";
import { confirmDialog } from "@/utils/dialog";
import { gitService } from "@/services/git";
import type { ChatAttachment, LogEntry } from "@/types";
import {
  SendIcon,
  TrashIcon,
  SpinnerIcon,
  CopyIcon,
  CheckIcon,
  FileEditIcon,
  GitCommitIcon,
  XIcon,
  SearchIcon,
} from "@/components/common/Icons";

type PickerKind = "file" | "commit" | null;

/** 会话搜索的命中高亮：按小写匹配切分，命中片段用强调色标出。 */
function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  let at = lower.indexOf(q);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={key++}
        className="bg-bg-hover text-accent rounded-sm px-0.5"
      >
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/** 返回第一条命中查询的消息内容摘要（单行、截断），无命中返回 null。 */
function findMessageSnippet(
  messages: { content: string }[],
  query: string,
): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hit = messages.find((m) => m.content.toLowerCase().includes(q));
  if (!hit) return null;
  const firstLine = hit.content.split("\n").find((l) => l.trim()) ?? "";
  const at = firstLine.toLowerCase().indexOf(q);
  const start = Math.max(0, at - 20);
  const snippet = firstLine.slice(start, start + 80).trim();
  return (start > 0 ? "…" : "") + snippet + "…";
}

function CopyButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // 复位定时器挂在 effect 上，组件卸载时自动清理，不产生悬挂 setTimeout。
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={t("chat.copy")}
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

/** 单条消息气泡。Memoized：流式输出期间只有内容在变的那条会重渲染。 */
const MessageBubble = memo(function MessageBubble({
  role,
  content,
}: {
  role: string;
  content: string;
}) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`group max-w-[80%] rounded-lg px-4 py-2.5 ${
          role === "user"
            ? "bg-bg-elevated border border-border"
            : "bg-bg-surface border border-border"
        }`}
      >
        {role === "user" ? (
          <p className="text-sm text-text-primary whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            <MarkdownRenderer content={content} />
            <div className="flex justify-end mt-1 -mb-1">
              <CopyButton content={content} />
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export function ChatView() {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const log = useRepoStore((s) => s.log);
  const sessions = useAiStore((s) => currentPath ? s.sessionsByRepo[currentPath] ?? [] : []);
  const activeSessionId = useAiStore((s) => currentPath ? s.activeSessionByRepo[currentPath] ?? null : null);
  const chatMessages = sessions.find((session) => session.id === activeSessionId)?.messages ?? [];
  const loading = useAiStore((s) => currentPath ? Boolean(s.activeRequestByScope[`${currentPath}\u0000chat`]) : false);
  const streamingText = useAiStore((s) => currentPath ? s.streamingTextByRepo[currentPath] ?? null : null);
  const sendChatMessage = useAiStore((s) => s.sendChatMessage);
  const cancelTask = useAiStore((s) => s.cancelTask);
  const loadSessions = useAiStore((s) => s.loadSessions);
  const createSession = useAiStore((s) => s.createSession);
  const selectSession = useAiStore((s) => s.selectSession);
  const renameSession = useAiStore((s) => s.renameSession);
  const deleteSession = useAiStore((s) => s.deleteSession);
  const { config } = useSettingsStore();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // 会话侧栏搜索：匹配标题或任意消息内容。
  const [sessionSearch, setSessionSearch] = useState("");

  // 会话过滤：标题或消息内容命中即保留；标题命中标亮，仅消息命中时显示摘要。
  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions.map((session) => ({ session, snippet: null as string | null }));
    return sessions
      .map((session) => {
        const titleHit = session.title.toLowerCase().includes(q);
        const snippet = titleHit ? null : findMessageSnippet(session.messages, q);
        return titleHit || snippet !== null ? { session, snippet } : null;
      })
      .filter((v): v is { session: (typeof sessions)[number]; snippet: string | null } => v !== null);
  }, [sessions, sessionSearch]);
  // Session being renamed via the input dialog (replaces window.prompt).
  const [renamingSession, setRenamingSession] = useState<{ id: string; title: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Picker state
  const [picker, setPicker] = useState<PickerKind>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [filesByRepo, setFilesByRepo] = useState<Record<string, string[]>>({});
  const [filesLoadingFor, setFilesLoadingFor] = useState<string | null>(null);
  const fileRequestRef = useRef(0);
  const files = currentPath ? filesByRepo[currentPath] ?? [] : [];
  const filesLoading = currentPath !== null && filesLoadingFor === currentPath;
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentPath) void loadSessions(currentPath);
  }, [currentPath, loadSessions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, streamingText]);

  // Reset transient context when switching repos and invalidate stale file requests.
  useEffect(() => {
    fileRequestRef.current += 1;
    setFilesLoadingFor(null);
    setAttachments([]);
    setPicker(null);
    setPickerQuery("");
  }, [currentPath]);

  // Close picker on outside click
  useEffect(() => {
    if (!picker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPicker(null);
        setPickerQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [picker]);

  const loadFiles = useCallback(async () => {
    if (!currentPath || Object.prototype.hasOwnProperty.call(filesByRepo, currentPath)) return;
    const repoPath = currentPath;
    const requestId = ++fileRequestRef.current;
    setFilesLoadingFor(repoPath);
    try {
      const list = await gitService.listFiles(repoPath);
      if (fileRequestRef.current !== requestId) return;
      setFilesByRepo((prev) => ({ ...prev, [repoPath]: list }));
    } catch (e) {
      if (fileRequestRef.current === requestId) {
        console.error("[aigit] listFiles failed:", e);
      }
    } finally {
      if (fileRequestRef.current === requestId) {
        setFilesLoadingFor(null);
      }
    }
  }, [currentPath, filesByRepo]);

  const openPicker = useCallback(
    (kind: PickerKind) => {
      setPicker((prev) => (prev === kind ? null : kind));
      setPickerQuery("");
      if (kind === "file") {
        loadFiles();
      }
    },
    [loadFiles]
  );

  const addFileAttachment = async (path: string) => {
    const sensitive = isSensitivePath(path);
    if (sensitive && !(await confirmDialog(t("common.confirmAction"), t("chat.sensitiveConfirm", { path })))) return;
    setAttachments((prev) => {
      if (prev.some((a) => a.kind === "file" && a.path === path)) return prev;
      return [...prev, { kind: "file", path, confirmed: sensitive }];
    });
  };

  const addCommitAttachment = (hash: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.kind === "commit" && a.hash === hash)) return prev;
      return [...prev, { kind: "commit", hash }];
    });
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const filteredFiles = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return files.slice(0, 200);
    return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
  }, [files, pickerQuery]);

  const filteredCommits = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return log.slice(0, 50);
    return log
      .filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.short_hash.toLowerCase().includes(q) ||
          e.author.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [log, pickerQuery]);

  const handleSend = async () => {
    if (!input.trim() || !config || loading || !currentPath) return;
    const msg = input.trim();
    const estimated = estimateTokens(msg) + chatMessages.reduce((sum, item) => sum + estimateTokens(item.content), 0);
    if (estimated >= LARGE_CONTEXT_TOKENS && !(await confirmDialog(t("common.confirmAction"), t("chat.largeContextConfirm", { count: estimated.toLocaleString() })))) return;
    const atts = attachments.length > 0 ? attachments : undefined;
    setInput("");
    setAttachments([]);
    await sendChatMessage(msg, currentPath, atts);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (currentPath && activeSessionId) void deleteSession(currentPath, activeSessionId);
  };

  const handleSuggestion = (suggestion: string) => {
    if (!currentPath || !config || loading) return;
    const atts = attachments.length > 0 ? attachments : undefined;
    sendChatMessage(suggestion, currentPath, atts);
  };

  const suggestions = [
    t("chat.suggestion1"),
    t("chat.suggestion2"),
    t("chat.suggestion3"),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-full">
        <aside className="w-56 shrink-0 border-r border-border bg-bg-surface flex flex-col">
          <div className="p-2 border-b border-border space-y-1.5">
            <button className="btn-secondary w-full text-xs" disabled={!currentPath} onClick={() => currentPath && createSession(currentPath)}>{t("chat.newSession")}</button>
            <div className="relative">
              <SearchIcon
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder={t("chat.searchPlaceholder")}
                className="input text-xs py-1.5 pl-7 w-full"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {filteredSessions.length === 0 && sessionSearch.trim() && (
              <div className="px-2 py-1.5 text-xs text-text-muted">{t("chat.noSessionMatch")}</div>
            )}
            {filteredSessions.map(({ session, snippet }) => <div key={session.id} className={`group flex items-center rounded ${session.id === activeSessionId ? "bg-bg-hover" : "hover:bg-bg-hover"}`}>
              <button className="flex-1 min-w-0 text-left px-2 py-2 text-xs" onClick={() => currentPath && selectSession(currentPath, session.id)}>
                <span className="block truncate" title={session.title}>
                  <HighlightText text={session.title} query={sessionSearch} />
                </span>
                {snippet && (
                  <span className="block truncate text-2xs text-text-muted" title={snippet}>
                    <HighlightText text={snippet} query={sessionSearch} />
                  </span>
                )}
              </button>
              <button className="opacity-0 group-hover:opacity-100 px-1 text-text-muted" aria-label={t("chat.rename")} onClick={() => setRenamingSession({ id: session.id, title: session.title })}>✎</button>
              <button className="opacity-0 group-hover:opacity-100 px-1 text-text-muted hover:text-danger" aria-label={t("chat.delete")} onClick={() => { void (async () => { if (!currentPath) return; if (await confirmDialog(t("common.confirmAction"), t("chat.deleteConfirm"))) void deleteSession(currentPath, session.id); })(); }}><XIcon size={12} /></button>
            </div>)}
          </div>
        </aside>
        <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center px-5 h-12 border-b border-border">
        <h2 className="text-base font-semibold">{t("chat.title")}</h2>
        {currentPath && (
          <span className="text-xs text-text-muted ml-3">
            {t("chat.context", { name: currentPath.split(/[\\/]/).pop() })}
          </span>
        )}
        <div className="flex-1" />
        {chatMessages.length > 0 && (
          <button onClick={handleClear} className="btn-ghost text-xs">
            <TrashIcon size={14} />
            {t("chat.clear")}
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-5 space-y-5">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-text-secondary mb-3">
              {t("chat.emptyHint")}
            </p>
            <div className="flex flex-col gap-1.5 mt-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestion(suggestion)}
                  disabled={!config || !currentPath}
                  className="text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover px-4 py-2 rounded transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((msg, idx) => {
          // While a chat stream is in flight its text lives in
          // `streamingTextByRepo`; render it in the placeholder bubble so the
          // session map does not need to be rebuilt on every delta.
          const isStreamingBubble =
            loading && streamingText !== null && msg.role === "assistant" && idx === chatMessages.length - 1;
          const content = isStreamingBubble ? streamingText : msg.content;
          return <MessageBubble key={idx} role={msg.role} content={content} />;
        })}

        {loading && (streamingText === null || streamingText === "") && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 bg-bg-surface border border-border rounded-lg px-4 py-2.5">
              <SpinnerIcon size={14} className="text-text-muted" />
              <span className="text-sm text-text-muted">{t("chat.thinking")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att, idx) => (
              <AttachmentChip
                key={att.kind === "file" ? `f:${att.path}` : `c:${att.hash}`}
                attachment={att}
                log={log}
                onRemove={() => removeAttachment(idx)}
              />
            ))}
          </div>
        )}

        <div ref={pickerRef} className="relative">
          {/* Picker popover */}
          {picker && (
            <div className="absolute bottom-full left-0 mb-2 w-96 max-w-full bg-bg-elevated border border-border rounded-md shadow-lg z-30 flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <SearchIcon size={12} className="text-text-muted shrink-0" />
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder={
                    picker === "file"
                      ? t("chatContext.filePickerTitle")
                      : t("chatContext.commitPickerTitle")
                  }
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={() => {
                    setPicker(null);
                    setPickerQuery("");
                  }}
                  className="text-text-muted hover:text-text-primary shrink-0"
                  aria-label={t("common.cancel")}
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="max-h-60 overflow-auto">
                {picker === "file" && filesLoading && (
                  <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-text-muted">
                    <SpinnerIcon size={12} />
                    {t("common.loading")}
                  </div>
                )}
                {picker === "file" && !filesLoading && filteredFiles.length === 0 && (
                  <div className="px-3 py-6 text-xs text-text-muted text-center">
                    {files.length === 0 ? t("chatContext.parseError") : t("common.noResults")}
                  </div>
                )}
                {picker === "file" &&
                  !filesLoading &&
                  filteredFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        addFileAttachment(f);
                        setPicker(null);
                        setPickerQuery("");
                      }}
                      className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary truncate"
                      title={f}
                    >
                      <FileEditIcon size={12} className="shrink-0 text-text-muted" />
                      <span className="truncate font-mono">{f}</span>
                    </button>
                  ))}
                {picker === "commit" && filteredCommits.length === 0 && (
                  <div className="px-3 py-6 text-xs text-text-muted text-center">
                    {t("common.noResults")}
                  </div>
                )}
                {picker === "commit" &&
                  filteredCommits.map((entry: LogEntry) => (
                    <button
                      key={entry.hash}
                      onClick={() => {
                        addCommitAttachment(entry.hash);
                        setPicker(null);
                        setPickerQuery("");
                      }}
                      className="flex items-start gap-2 w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      title={entry.message}
                    >
                      <GitCommitIcon size={12} className="shrink-0 text-text-muted mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{entry.message}</div>
                        <div className="text-2xs text-text-muted font-mono">
                          {entry.short_hash} · {entry.author}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 bg-bg-elevated border border-border rounded-lg p-3 focus-within:border-border-strong transition-colors">
            {/* Attach buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => openPicker("file")}
                disabled={!config || !currentPath}
                className={picker === "file" ? "text-accent" : "text-text-muted hover:text-text-primary"}
                title={t("chatContext.mentionFile")}
                aria-label={t("chatContext.attachFile")}
              >
                <FileEditIcon size={16} />
              </button>
              <button
                onClick={() => openPicker("commit")}
                disabled={!config || !currentPath}
                className={picker === "commit" ? "text-accent" : "text-text-muted hover:text-text-primary"}
                title={t("chatContext.mentionCommit")}
                aria-label={t("chatContext.attachCommit")}
              >
                <GitCommitIcon size={16} />
              </button>
            </div>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.inputPlaceholder")}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none resize-none max-h-32"
              rows={1}
              disabled={!config || !currentPath}
            />
            <button
              onClick={() => loading && currentPath ? void cancelTask(currentPath, "chat") : void handleSend()}
              disabled={loading ? !currentPath : !input.trim() || !config || !currentPath}
              aria-busy={loading}
              className={loading ? "btn-secondary shrink-0" : "btn-primary shrink-0"}
              aria-label={loading ? t("chat.stop") : t("chat.send")}
            >
              {loading ? <XIcon size={14} /> : <SendIcon size={14} />}
              {loading && t("chat.stop")}
            </button>
          </div>
        </div>

        {!config && (
          <p className="text-xs text-text-muted mt-2 px-1">
            {t("chat.configureHint")}
          </p>
        )}
        {config && !currentPath && (
          <p className="text-xs text-text-muted mt-2 px-1">
            {t("chat.openRepoHint")}
          </p>
        )}
        {config && currentPath && attachments.length === 0 && picker === null && (
          <p className="text-2xs text-text-muted mt-2 px-1">
            {t("chatContext.attachmentsHint")}
          </p>
        )}
      </div>
        </div>
      </div>
      <InputDialog
        open={renamingSession !== null}
        title={t("chat.renamePrompt")}
        initialValue={renamingSession?.title ?? ""}
        onCancel={() => setRenamingSession(null)}
        onConfirm={(value) => {
          if (currentPath && renamingSession) {
            void renameSession(currentPath, renamingSession.id, value);
          }
          setRenamingSession(null);
        }}
      />
    </div>
  );
}

/** Render a single attachment as a removable chip. */
function AttachmentChip({
  attachment,
  log,
  onRemove,
}: {
  attachment: ChatAttachment;
  log: LogEntry[];
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const label =
    attachment.kind === "file"
      ? attachment.path
      : (() => {
          const entry = log.find((e) => e.hash === attachment.hash);
          return entry
            ? `${entry.short_hash} ${entry.message}`.trim()
            : attachment.hash.slice(0, 7);
        })();

  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-bg-surface border border-border text-2xs text-text-secondary max-w-xs">
      {attachment.kind === "file" ? (
        <FileEditIcon size={11} className="shrink-0 text-text-muted" />
      ) : (
        <GitCommitIcon size={11} className="shrink-0 text-text-muted" />
      )}
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        onClick={onRemove}
        className="shrink-0 text-text-muted hover:text-danger p-0.5 rounded"
        aria-label={t("chatContext.removeAttachment")}
      >
        <XIcon size={11} />
      </button>
    </span>
  );
}
