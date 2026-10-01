import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { githubService } from "@/services/github";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { useModalAccessibility } from "@/utils/modalA11y";
import type { GhStatus } from "@/types";
import {
  AlertCircleIcon,
  CheckIcon,
  GithubIcon,
  SpinnerIcon,
  XIcon,
} from "@/components/common/Icons";

/** Mirrors the backend slug check (plus a stricter first character rule). */
export function isValidRepoSlug(value: string): boolean {
  const slug = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const parts = value.split("/");
  if (parts.length > 2) return false;
  return parts.every((part) => slug.test(part));
}

/** Mirrors the backend host normalization: strip scheme/slashes, lowercase. */
export function normalizeRepoHost(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return trimmed || "github.com";
}

/** Frontend mirror of the backend hostname[:port] validation. */
export function isValidRepoHost(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*(\.[a-z0-9]+)?(:\d{1,5})?$/.test(normalizeRepoHost(value));
}

/** Best-effort default repo name from the working directory basename. */
export function defaultRepoName(path: string | null): string {
  if (!path) return "";
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-]+/, "")
    .slice(0, 100);
}

interface GitHubCreateContextValue {
  showGitHubCreate: () => void;
}

const GitHubCreateContext = createContext<GitHubCreateContextValue | null>(null);

export function GitHubCreateProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const value = useMemo(
    () => ({ showGitHubCreate: () => setVisible(true) }),
    [],
  );
  return (
    <GitHubCreateContext.Provider value={value}>
      {children}
      {visible && <GitHubCreateRepoDialog onClose={() => setVisible(false)} />}
    </GitHubCreateContext.Provider>
  );
}

export function useGitHubCreate() {
  const context = useContext(GitHubCreateContext);
  if (!context) throw new Error("useGitHubCreate must be used within GitHubCreateProvider");
  return context;
}

function GhGate({
  gh,
  host,
  onRetry,
  onDismiss,
}: {
  gh: GhStatus;
  host: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-xs">
      <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-2">
        <p>{gh.installed ? t("githubCreate.ghUnauthed", { host }) : t("githubCreate.ghMissing")}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary py-1 text-xs" onClick={onRetry}>
            {t("githubCreate.retry")}
          </button>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onDismiss}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GitHubCreateRepoDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((s) => s.currentPath);
  const loadRemoteState = useRepoStore((s) => s.loadRemoteState);
  const refreshBranches = useRepoStore((s) => s.refreshBranches);
  const refreshRepoInfo = useRepoStore((s) => s.refreshRepoInfo);
  const toast = useToastStore();
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState(() => defaultRepoName(currentPath));
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [host, setHost] = useState("github.com");
  const [checkedHost, setCheckedHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedHost = normalizeRepoHost(host);
  const hostValid = isValidRepoHost(host);
  // Latest host for the probe; checkGh stays dependency-free so editing the
  // host field never re-fires the check per keystroke (blur/retry instead).
  const hostRef = useRef(normalizedHost);
  hostRef.current = normalizedHost;
  // Esc during a busy operation must not close; the trap/guard lives here.
  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, () => {
    if (!busy) onClose();
  }, true);

  const checkGh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setGh(await githubService.ghStatusForHost(hostRef.current));
      setCheckedHost(hostRef.current);
    } catch (reason) {
      setError(formatError(reason));
      setGh({ installed: false, authenticated: false, version: null, error: null });
      setCheckedHost(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkGh();
  }, [checkGh]);

  const ghReady = !!gh?.installed && !!gh?.authenticated;
  const nameValid = isValidRepoSlug(name.trim());
  const canSubmit = Boolean(currentPath) && !checking && ghReady && nameValid && hostValid;

  const submit = async () => {
    if (!currentPath || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await githubService.createRepo(currentPath, {
        name: name.trim(),
        description: description.trim() || null,
        private: isPrivate,
        host: normalizedHost,
      });
      await loadRemoteState(currentPath);
      await Promise.all([refreshBranches(true), refreshRepoInfo()]);
      toast.success(
        result.pushed
          ? t("githubCreate.success", { url: result.url, remote: result.remote_name })
          : t("githubCreate.successNoCommits", { url: result.url, remote: result.remote_name }),
      );
      onClose();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-create-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="w-full max-w-lg rounded-lg border border-border bg-bg-surface shadow-xl">
        <div className="flex items-center px-5 h-14 border-b border-border">
          <h2 id="github-create-title" className="font-semibold flex items-center gap-2">
            <GithubIcon size={16} /> {t("githubCreate.title")}
          </h2>
          <div className="flex-1" />
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost" aria-label={t("common.cancel")}>
            <XIcon size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {checking && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <SpinnerIcon size={13} /> {t("githubCreate.checking")}
            </div>
          )}
          {!checking && gh && !ghReady && (
            <GhGate gh={gh} host={normalizedHost} onRetry={() => void checkGh()} onDismiss={onClose} />
          )}

          <label className="block text-sm">
            <span className="block mb-1.5 text-text-secondary">{t("githubCreate.host")}</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              onBlur={() => {
                if (hostValid && normalizedHost !== checkedHost) void checkGh();
              }}
              disabled={busy}
              maxLength={253}
              placeholder={t("githubCreate.hostPlaceholder")}
              className="w-full bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
            />
            <span className="block mt-1 text-2xs text-text-muted">{t("githubCreate.hostHint")}</span>
            {host.trim() && !hostValid && (
              <span className="block mt-1 text-xs text-danger">{t("githubCreate.hostInvalid")}</span>
            )}
          </label>

          <label className="block text-sm">
            <span className="block mb-1.5 text-text-secondary">{t("githubCreate.name")}</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy || !ghReady}
              maxLength={201}
              placeholder={t("githubCreate.namePlaceholder")}
              className="w-full bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
            />
            {name.trim() && !nameValid && (
              <span className="block mt-1 text-xs text-danger">{t("githubCreate.nameInvalid")}</span>
            )}
          </label>

          <label className="block text-sm">
            <span className="block mb-1.5 text-text-secondary">{t("githubCreate.description")}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy || !ghReady}
              maxLength={350}
              placeholder={t("githubCreate.descriptionPlaceholder")}
              className="w-full bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
              disabled={busy || !ghReady}
            />
            {t("githubCreate.private")}
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircleIcon size={14} className="shrink-0 mt-0.5" />
              <span className="break-words whitespace-pre-wrap">{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">{t("common.cancel")}</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
            aria-busy={busy}
            className="btn-primary"
          >
            {busy ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
            {busy ? t("githubCreate.creating") : t("githubCreate.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
