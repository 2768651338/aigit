import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import {
  SendIcon,
  TrashIcon,
  SpinnerIcon,
} from "@/components/common/Icons";

export function ChatView() {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const chatMessages = useAiStore((s) =>
    currentPath ? s.chatByRepo[currentPath] ?? [] : []
  );
  const loading = useAiStore((s) => s.loading);
  const sendChatMessage = useAiStore((s) => s.sendChatMessage);
  const clearChat = useAiStore((s) => s.clearChat);
  const { config } = useSettingsStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = async () => {
    if (!input.trim() || !config || loading || !currentPath) return;
    const msg = input.trim();
    setInput("");
    await sendChatMessage(msg, currentPath, config);
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
                  onClick={() =>
                    currentPath &&
                    config &&
                    sendChatMessage(suggestion, currentPath, config)
                  }
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
              className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === "user"
                  ? "bg-bg-elevated border border-border"
                  : "bg-bg-surface border border-border"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-sm text-text-primary whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <MarkdownRenderer content={msg.content} />
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
        <div className="flex items-end gap-2 bg-bg-elevated border border-border rounded-lg p-3 focus-within:border-border-strong transition-colors">
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
          >
            {loading ? <SpinnerIcon size={14} /> : <SendIcon size={14} />}
          </button>
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
      </div>
    </div>
  );
}

