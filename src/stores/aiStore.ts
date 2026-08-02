import { create } from "zustand";
import i18n from "@/i18n";
import type {
  AppConfig, ChatAttachment, ChatAttachmentMetadata, ChatMessage, ChatSession,
  CredentialProvider, FindingStatus, PersistedChatSession, ReviewReport,
} from "@/types";
import { aiService, type AiRequestKind, type AiStreamEvent } from "@/services/ai";
import { chatHistoryService } from "@/services/chatHistory";
import { configService } from "@/services/config";
import { formatError } from "@/utils/error";
import { useToastStore } from "@/stores/toastStore";

interface SettingsState {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<boolean>;
  setApiKey: (provider: CredentialProvider, apiKey: string) => Promise<void>;
  deleteApiKey: (provider: CredentialProvider) => Promise<void>;
  setConfig: (config: AppConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  config: null, loading: false, error: null,
  loadConfig: async () => {
    set({ loading: true });
    try { set({ config: await configService.getConfig(), loading: false, error: null }); }
    catch (e) { console.error("[aigit] Config load failed:", e); set({ error: formatError(e), loading: false }); }
  },
  saveConfig: async (config) => {
    try { set({ config: await configService.saveConfig(config), error: null }); return true; }
    catch (e) { console.error("[aigit] Config save failed:", e); set({ error: formatError(e) }); return false; }
  },
  setApiKey: async (provider, apiKey) => {
    try { set({ config: await configService.setApiKey(provider, apiKey), error: null }); }
    catch (e) { set({ error: formatError(e) }); throw e; }
  },
  deleteApiKey: async (provider) => {
    try { set({ config: await configService.deleteApiKey(provider), error: null }); }
    catch (e) { set({ error: formatError(e) }); throw e; }
  },
  setConfig: (config) => set({ config }),
}));

export const DEFAULT_CONTEXT_LIMIT = 32_000;
export const LARGE_CONTEXT_TOKENS = 8_000;
const KEEP_RECENT_TOKENS = 20_000;

export function estimateTokens(text: string): number {
  const ascii = (text.match(/[\x00-\x7F]/g) ?? []).length;
  return Math.ceil(ascii / 4 + (text.length - ascii));
}

export function buildContext(messages: ChatMessage[], limit = DEFAULT_CONTEXT_LIMIT): { messages: ChatMessage[]; tokens: number; summarized: boolean } {
  const total = messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
  if (total <= limit) return { messages, tokens: total, summarized: false };
  const kept: ChatMessage[] = [];
  let keptTokens = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(messages[i].content) + 4;
    if (kept.length > 0 && keptTokens + cost > Math.min(KEEP_RECENT_TOKENS, limit - 256)) break;
    kept.unshift(messages[i]); keptTokens += cost;
  }
  const omitted = messages.slice(0, messages.length - kept.length);
  const summary = omitted.map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").slice(0, 180)}`).join("\n").slice(0, 1800);
  const summaryMessage: ChatMessage = { role: "system", content: `Earlier conversation summary (${omitted.length} messages):\n${summary}` };
  return { messages: [summaryMessage, ...kept], tokens: estimateTokens(summaryMessage.content) + keptTokens, summarized: true };
}

export function isSensitivePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return name === ".env" || name.startsWith(".env.") || /credential|secret/.test(name) || /\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/i.test(name);
}

function id(): string { return crypto.randomUUID(); }
function titleFor(content: string): string { return content.replace(/\s+/g, " ").trim().slice(0, 48) || i18n.t("chat.newSession"); }
function toastAiError(e: unknown, titleKey: string) { useToastStore.getState().error(formatError(e), i18n.t(titleKey)); }
function toWire(messages: ChatSession["messages"]): ChatMessage[] { return messages.map(({ role, content }) => ({ role, content })); }
function toMetadata(attachments: ChatAttachment[] = []): ChatAttachmentMetadata[] {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    label: attachment.kind === "file" ? attachment.path : attachment.hash.slice(0, 12),
    path: attachment.kind === "file" ? attachment.path : null,
    hash: attachment.kind === "commit" ? attachment.hash : null,
    estimated_tokens: 0, size_bytes: 0,
    sensitive: attachment.kind === "file" && isSensitivePath(attachment.path),
  }));
}

interface AiTaskState {
  repoPath: string;
  kind: AiRequestKind;
  requestId: string;
  status: "started" | "streaming" | "completed" | "cancelled" | "failed";
  content: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string;
}

export function aiTaskKey(repoPath: string, kind: AiRequestKind, requestId: string): string {
  return `${repoPath}\u0000${kind}\u0000${requestId}`;
}

function hasActiveTasks(activeRequestByScope: Record<string, string | null>): boolean {
  return Object.values(activeRequestByScope).some(Boolean);
}

function clearActiveScope(state: Pick<AiState, "activeRequestByScope">, scope: string): Pick<AiState, "activeRequestByScope" | "loading"> {
  const activeRequestByScope = { ...state.activeRequestByScope, [scope]: null };
  return { activeRequestByScope, loading: hasActiveTasks(activeRequestByScope) };
}

interface AiState {
  sessionsByRepo: Record<string, ChatSession[]>;
  activeSessionByRepo: Record<string, string | null>;
  loadedRepos: Record<string, boolean>;
  lastResultByRepo: Record<string, string | null>;
  reviewByRepo: Record<string, ReviewReport | null>;
  tasks: Record<string, AiTaskState>;
  activeRequestByScope: Record<string, string | null>;
  loading: boolean;
  localSaveEnabled: boolean;
  contextLimit: number;
  loadSessions: (repoPath: string) => Promise<void>;
  loadReview: (repoPath: string) => Promise<void>;
  updateFindingStatus: (repoPath: string, findingId: string, status: FindingStatus) => Promise<void>;
  createSession: (repoPath: string) => void;
  selectSession: (repoPath: string, sessionId: string) => void;
  renameSession: (repoPath: string, sessionId: string, title: string) => Promise<void>;
  deleteSession: (repoPath: string, sessionId: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  setLocalSaveEnabled: (enabled: boolean) => void;
  generateCommitMessage: (repoPath: string) => Promise<string>;
  reviewCode: (repoPath: string, filePath?: string, stagedOnly?: boolean) => Promise<ReviewReport>;
  sendChatMessage: (content: string, repoPath: string | null, attachments?: ChatAttachment[]) => Promise<void>;
  cancelTask: (repoPath: string, kind: AiRequestKind) => Promise<void>;
  taskFor: (repoPath: string, kind: AiRequestKind) => AiTaskState | undefined;
}

export const useAiStore = create<AiState>((set, get) => ({
  sessionsByRepo: {}, activeSessionByRepo: {}, loadedRepos: {}, lastResultByRepo: {}, reviewByRepo: {},
  tasks: {}, activeRequestByScope: {}, loading: false,
  localSaveEnabled: localStorage.getItem("aigit.chat.localSave") !== "false", contextLimit: DEFAULT_CONTEXT_LIMIT,
  loadSessions: async (repoPath) => {
    if (get().loadedRepos[repoPath]) return;
    try {
      const result = await chatHistoryService.load(repoPath);
      set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: result.sessions }, activeSessionByRepo: { ...state.activeSessionByRepo, [repoPath]: result.sessions[0]?.id ?? null }, loadedRepos: { ...state.loadedRepos, [repoPath]: true } }));
      if (result.recovered_corrupt_data) useToastStore.getState().info(i18n.t("chat.corruptRecovered"));
    } catch (e) { toastAiError(e, "chat.historyError"); set((state) => ({ loadedRepos: { ...state.loadedRepos, [repoPath]: true } })); }
  },
  createSession: (repoPath) => {
    const now = Date.now(); const session: ChatSession = { id: id(), repo_path: repoPath, title: i18n.t("chat.newSession"), created_at: now, updated_at: now, messages: [] };
    set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: [session, ...(state.sessionsByRepo[repoPath] ?? [])] }, activeSessionByRepo: { ...state.activeSessionByRepo, [repoPath]: session.id } }));
  },
  selectSession: (repoPath, sessionId) => set((state) => ({ activeSessionByRepo: { ...state.activeSessionByRepo, [repoPath]: sessionId } })),
  renameSession: async (repoPath, sessionId, title) => {
    let updated: ChatSession | undefined;
    set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: (state.sessionsByRepo[repoPath] ?? []).map((session) => session.id === sessionId ? (updated = { ...session, title: title.trim().slice(0, 200) || session.title, updated_at: Date.now() }) : session) } }));
    if (updated && get().localSaveEnabled) {
      try {
        await chatHistoryService.save(updated as PersistedChatSession);
      } catch (e) {
        toastAiError(e, "chat.historyError");
      }
    }
  },
  deleteSession: async (repoPath, sessionId) => {
    const sessions = (get().sessionsByRepo[repoPath] ?? []).filter((session) => session.id !== sessionId);
    set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: sessions }, activeSessionByRepo: { ...state.activeSessionByRepo, [repoPath]: sessions[0]?.id ?? null } }));
    if (get().localSaveEnabled) await chatHistoryService.delete(repoPath, sessionId);
  },
  clearAllHistory: async () => { await chatHistoryService.clear(); set({ sessionsByRepo: {}, activeSessionByRepo: {}, loadedRepos: {} }); },
  setLocalSaveEnabled: (enabled) => { localStorage.setItem("aigit.chat.localSave", String(enabled)); set({ localSaveEnabled: enabled }); },
  generateCommitMessage: async (repoPath) => {
    const requestId = aiService.createRequestId();
    const scope = `${repoPath}\u0000commit`;
    const key = aiTaskKey(repoPath, "commit", requestId);
    const onEvent = (event: AiStreamEvent) => set((state) => {
      const task = state.tasks[key] ?? { repoPath, kind: "commit" as const, requestId, status: "started" as const, content: "" };
      const next = { ...task };
      if (event.type === "Delta") { next.content += event.delta; next.status = "streaming"; }
      if (event.type === "Usage") { next.inputTokens = event.inputTokens; next.outputTokens = event.outputTokens; }
      if (event.type === "Completed") next.status = "completed";
      if (event.type === "Cancelled") next.status = "cancelled";
      if (event.type === "Failed") { next.status = "failed"; next.error = event.message; }
      return {
        tasks: { ...state.tasks, [key]: next },
        activeRequestByScope: event.type === "Completed" || event.type === "Cancelled" || event.type === "Failed"
          ? { ...state.activeRequestByScope, [scope]: null }
          : state.activeRequestByScope,
        lastResultByRepo: { ...state.lastResultByRepo, [repoPath]: next.content },
        loading: Object.values({ ...state.activeRequestByScope, [scope]: event.type === "Completed" || event.type === "Cancelled" || event.type === "Failed" ? null : requestId }).some(Boolean),
      };
    });
    set((state) => ({ tasks: { ...state.tasks, [key]: { repoPath, kind: "commit", requestId, status: "started", content: "" } }, activeRequestByScope: { ...state.activeRequestByScope, [scope]: requestId }, loading: true }));
    const { done } = aiService.streamCommitMessage(repoPath, { onEvent }, requestId);
    try { return await done; } catch (e) { set((state) => clearActiveScope(state, scope)); throw e; }
  },
  reviewCode: async (repoPath, filePath, stagedOnly) => {
    const requestId = aiService.createRequestId();
    const scope = `${repoPath}\u0000review`;
    const key = aiTaskKey(repoPath, "review", requestId);
    const onEvent = (event: AiStreamEvent) => set((state) => {
      const task = state.tasks[key] ?? { repoPath, kind: "review" as const, requestId, status: "started" as const, content: "" };
      const next = { ...task };
      if (event.type === "Delta") { next.content += event.delta; next.status = "streaming"; }
      if (event.type === "Usage") { next.inputTokens = event.inputTokens; next.outputTokens = event.outputTokens; }
      if (event.type === "Completed") next.status = "completed";
      if (event.type === "Cancelled") next.status = "cancelled";
      if (event.type === "Failed") { next.status = "failed"; next.error = event.message; }
      const terminal = next.status === "completed" || next.status === "cancelled" || next.status === "failed";
      const activeRequestByScope = terminal ? { ...state.activeRequestByScope, [scope]: null } : state.activeRequestByScope;
      return { tasks: { ...state.tasks, [key]: next }, lastResultByRepo: { ...state.lastResultByRepo, [repoPath]: next.content }, activeRequestByScope, loading: hasActiveTasks(activeRequestByScope) };
    });
    set((state) => ({ tasks: { ...state.tasks, [key]: { repoPath, kind: "review", requestId, status: "started", content: "" } }, activeRequestByScope: { ...state.activeRequestByScope, [scope]: requestId }, lastResultByRepo: { ...state.lastResultByRepo, [repoPath]: "" }, loading: true }));
    const { done } = aiService.streamReviewCode(repoPath, filePath, stagedOnly, { onEvent }, requestId);
    try {
      await done;
      const report = await aiService.loadReviewReport(repoPath);
      if (!report) throw new Error(i18n.t("review.loadFailed"));
      set((state) => ({ reviewByRepo: { ...state.reviewByRepo, [repoPath]: report } }));
      useToastStore.getState().success(i18n.t("review.reviewDone"));
      return report;
    } catch (e) { set((state) => clearActiveScope(state, scope)); toastAiError(e, "review.reviewFailed"); throw e; }
  },
  loadReview: async (repoPath) => { try { const report = await aiService.loadReviewReport(repoPath); set((state) => ({ reviewByRepo: { ...state.reviewByRepo, [repoPath]: report } })); } catch (e) { toastAiError(e, "review.loadFailed"); } },
  updateFindingStatus: async (repoPath, findingId, status) => { try { const report = await aiService.updateReviewFinding(repoPath, findingId, status); set((state) => ({ reviewByRepo: { ...state.reviewByRepo, [repoPath]: report } })); } catch (e) { toastAiError(e, "review.updateFailed"); throw e; } },
  sendChatMessage: async (content, repoPath, attachments = []) => {
    if (!repoPath) return;
    let session = (get().sessionsByRepo[repoPath] ?? []).find((item) => item.id === get().activeSessionByRepo[repoPath]);
    if (!session) { get().createSession(repoPath); session = (get().sessionsByRepo[repoPath] ?? [])[0]; }
    if (!session) return;
    const now = Date.now();
    const user = { id: id(), role: "user" as const, content, created_at: now, attachments: toMetadata(attachments) };
    const next: ChatSession = { ...session, title: session.messages.length === 0 ? titleFor(content) : session.title, updated_at: now, messages: [...session.messages, user] };
    set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: [next, ...(state.sessionsByRepo[repoPath] ?? []).filter((item) => item.id !== next.id)] } }));
    if (get().localSaveEnabled) {
      try { await chatHistoryService.save(next); }
      catch (e) { toastAiError(e, "chat.historyError"); }
    }
    try {
      const context = buildContext(toWire(next.messages), get().contextLimit);
      const requestId = aiService.createRequestId();
      const scope = `${repoPath}\u0000chat`;
      const key = aiTaskKey(repoPath, "chat", requestId);
      const assistantId = id();
      const streaming: ChatSession = { ...next, messages: [...next.messages, { id: assistantId, role: "assistant", content: "", created_at: Date.now(), attachments: [] }] };
      set((state) => ({ sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: [streaming, ...(state.sessionsByRepo[repoPath] ?? []).filter((item) => item.id !== streaming.id)] }, tasks: { ...state.tasks, [key]: { repoPath, kind: "chat", requestId, status: "started", content: "" } }, activeRequestByScope: { ...state.activeRequestByScope, [scope]: requestId } }));
      const onEvent = (event: AiStreamEvent) => set((state) => {
        const task = state.tasks[key] ?? { repoPath, kind: "chat" as const, requestId, status: "started" as const, content: "" };
        const updated = { ...task };
        if (event.type === "Delta") { updated.content += event.delta; updated.status = "streaming"; }
        if (event.type === "Usage") { updated.inputTokens = event.inputTokens; updated.outputTokens = event.outputTokens; }
        if (event.type === "Completed") updated.status = "completed";
        if (event.type === "Cancelled") updated.status = "cancelled";
        if (event.type === "Failed") { updated.status = "failed"; updated.error = event.message; }
        const sessions = (state.sessionsByRepo[repoPath] ?? []).map((item) => item.id === streaming.id ? { ...item, updated_at: Date.now(), messages: item.messages.map((message) => message.id === assistantId ? { ...message, content: updated.content } : message) } : item);
        const terminal = updated.status === "completed" || updated.status === "cancelled" || updated.status === "failed";
        const activeRequestByScope = terminal ? { ...state.activeRequestByScope, [scope]: null } : state.activeRequestByScope;
        return { sessionsByRepo: { ...state.sessionsByRepo, [repoPath]: sessions }, tasks: { ...state.tasks, [key]: updated }, activeRequestByScope, loading: hasActiveTasks(activeRequestByScope) };
      });
      const { done } = aiService.streamRepoChat(context.messages, repoPath, attachments, { onEvent }, requestId);
      await done;
      const completed = (get().sessionsByRepo[repoPath] ?? []).find((item) => item.id === streaming.id);
      if (completed && get().localSaveEnabled) {
        try { await chatHistoryService.save(completed); }
        catch (e) { toastAiError(e, "chat.historyError"); }
      }
    } catch (e) { set((state) => clearActiveScope(state, `${repoPath}\u0000chat`)); toastAiError(e, "chat.errorTitle"); }
  },
  cancelTask: async (repoPath, kind) => {
    const requestId = get().activeRequestByScope[`${repoPath}\u0000${kind}`];
    if (requestId) await aiService.cancel(requestId);
  },
  taskFor: (repoPath, kind) => {
    const requestId = get().activeRequestByScope[`${repoPath}\u0000${kind}`];
    if (requestId) return get().tasks[aiTaskKey(repoPath, kind, requestId)];
    return Object.values(get().tasks).reverse().find((task) => task.repoPath === repoPath && task.kind === kind);
  },
}));
