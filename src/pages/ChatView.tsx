import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRepoStore } from "@/stores/repoStore";
import { useAiStore, useSettingsStore } from "@/stores/aiStore";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import {
  SendIcon,
  MessageSquareIcon,
  TrashIcon,
  AlertCircleIcon,
} from "@/components/common/Icons";

export function ChatView() {
  const { t } = useTranslation();
  const { currentPath } = useRepoStore();
  const { chatMessages, sendChatMessage, loading, error, clearChat } = useAiStore();
  const { config } = useSettingsStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = async () => {
    if (!input.trim() || !config || loading) return;
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

  const suggestions = [
    t("chat.suggestion1"),
    t("chat.suggestion2"),
    t("chat.suggestion3"),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-4 h-10 border-b border-border">
        <MessageSquareIcon size={16} className="text-accent mr-2" />
        <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
        {currentPath && (
          <span className="text-2xs text-text-muted ml-3">
            {t("chat.context", { name: currentPath.split(/[\\/]/).pop() })}
          </span>
        )}
        <div className="flex-1" />
        {chatMessages.length > 0 && (
          <button onClick={clearChat} className="btn-ghost text-2xs">
            <TrashIcon size={12} />
            {t("chat.clear")}
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquareIcon size={48} className="text-text-muted mb-3" />
            <p className="text-sm text-text-secondary mb-2">
              {t("chat.emptyHint")}
            </p>
            <div className="flex flex-col gap-1 mt-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => config && sendChatMessage(suggestion, currentPath, config)}
                  disabled={!config}
                  className="text-xs text-text-secondary hover:text-accent hover:bg-accent-glow px-3 py-1.5 rounded transition-colors"
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
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-accent/10 border border-accent/20"
                  : "bg-bg-elevated border border-border"
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
            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-danger/10 text-danger text-xs rounded border border-danger/20">
            <AlertCircleIcon size={14} />
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 bg-bg-elevated border border-border rounded-lg p-2 focus-within:border-accent/50 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.inputPlaceholder")}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none resize-none max-h-32"
            rows={1}
            disabled={!config}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !config}
            className="btn-primary shrink-0"
          >
            <SendIcon size={14} />
          </button>
        </div>
        {!config && (
          <p className="text-2xs text-text-muted mt-1.5 px-1">
            {t("chat.configureHint")}
          </p>
        )}
      </div>
    </div>
  );
}
