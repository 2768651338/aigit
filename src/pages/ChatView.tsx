import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
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

function CopyButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={t("chat.copy")}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

export function ChatView() {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const log = useRepoStore((s) => s.log);
  const chatMessages = useAiStore((s) =>
    currentPath ? s.chatByRepo[currentPath] ?? [] : []
  );
  const loading = useAiStore((s) => s.loading);
  const sendChatMessage = useAiStore((s) => s.sendChatMessage);
  const clearChat = useAiStore((s) => s.clearChat);
  const { config } = useSettingsStore();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Picker state
  const [picker, setPicker] = useState<PickerKind>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Reset attachments and picker when switching repos
  useEffect(() => {
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
    if (!currentPath || filesLoaded) return;
    setFilesLoading(true);
    try {
      const list = await gitService.listFiles(currentPath);
      setFiles(list);
      setFilesLoaded(true);
    } catch (e) {
      console.error("[aigit] listFiles failed:", e);
    } finally {
      setFilesLoading(false);
    }
  }, [currentPath, filesLoaded]);

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

  const addFileAttachment = (path: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.kind === "file" && a.path === path)) return prev;
      return [...prev, { kind: "file", path }];
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
    const atts = attachments.length > 0 ? attachments : undefined;
    setInput("");
    setAttachments([]);
    await sendChatMessage(msg, currentPath, config, atts);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (currentPath) clearChat(currentPath);
  };

  const handleSuggestion = (suggestion: string) => {
    if (!currentPath || !config || loading) return;
    const atts = attachments.length > 0 ? attachments : undefined;
    sendChatMessage(suggestion, currentPath, config, atts);
  };

  const suggestions = [
    t("chat.suggestion1"),
    t("chat.suggestion2"),
    t("chat.suggestion3"),
  ];

  return (
    <div className="flex flex-col h-full">
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

        {chatMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`group max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === "user"
                  ? "bg-bg-elevated border border-border"
                  : "bg-bg-surface border border-border"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-sm text-text-primary whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <>
                  <MarkdownRenderer content={msg.content} />
                  <div className="flex justify-end mt-1 -mb-1">
                    <CopyButton content={msg.content} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {loading && (
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
              onClick={handleSend}
              disabled={!input.trim() || loading || !config || !currentPath}
              className="btn-primary shrink-0"
              aria-label={t("chat.send")}
            >
              {loading ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
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
