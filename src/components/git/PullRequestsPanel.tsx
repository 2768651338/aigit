import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { aiService } from "@/services/ai";
import { githubService } from "@/services/github";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import type { GhStatus, PullRequest, PullRequestDetail } from "@/types";

export function PullRequestsPanel({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const path = useRepoStore((s) => s.currentPath);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const toast = useToastStore();
  const [items, setItems] = useState<PullRequest[]>([]);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("main");
  const [head, setHead] = useState(repoInfo?.current_branch || "");
  const [draft, setDraft] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setDetail(null);
    try {
      setStatus(await githubService.ghStatus(path));
      setItems(await githubService.list(path));
    } catch (error) {
      setItems([]);
      toast.error(formatError(error), t("pullRequests.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [path, t, toast]);

  useEffect(() => {
    setHead(repoInfo?.current_branch || "");
  }, [repoInfo?.current_branch]);
  useEffect(() => { void load(); }, [load]);

  const select = async (number: number) => {
    if (!path) return;
    setLoading(true);
    try { setDetail(await githubService.view(path, number)); }
    catch (error) { toast.error(formatError(error), t("pullRequests.viewFailed")); }
    finally { setLoading(false); }
  };

  const generate = async () => {
    if (!path || !base.trim() || !head.trim()) return;
    setCreating(true);
    try {
      const result = await aiService.generatePullRequestDraft(path, base.trim(), head.trim());
      setTitle(result.title); setBody(result.body);
    } catch (error) { toast.error(formatError(error), t("pullRequests.aiFailed")); }
    finally { setCreating(false); }
  };

  const create = async () => {
    if (!path || !title.trim() || !base.trim() || !head.trim()) return;
    setCreating(true);
    try {
      const result = await githubService.create(path, { title: title.trim(), body, base: base.trim(), head: head.trim(), draft });
      toast.success(t(result.backend === "browser" ? "pullRequests.browserOpened" : "pullRequests.created"));
      if (result.pull_request) await load();
    } catch (error) { toast.error(formatError(error), t("pullRequests.createFailed")); }
    finally { setCreating(false); }
  };

  const checkout = async (number: number) => {
    if (!path) return;
    try {
      await githubService.checkout(path, number);
      await Promise.all([useRepoStore.getState().refreshBranches(true), useRepoStore.getState().refreshLog(true)]);
      toast.success(t("pullRequests.checkedOut"));
    } catch (error) { toast.error(formatError(error), t("pullRequests.checkoutFailed")); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-80 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div><h2 className="font-semibold">{t("pullRequests.title")}</h2><p className="text-2xs text-text-muted">{status?.installed ? (status.authenticated ? t("pullRequests.ghReady") : t("pullRequests.ghUnauthed")) : t("pullRequests.ghMissing")}</p></div>
          <div className="flex gap-1">{onBack && <button className="btn-ghost text-xs" onClick={onBack}>{t("pullRequests.back")}</button>}<button className="btn-ghost text-xs" onClick={load} disabled={loading}>{t("changes.refresh")}</button></div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {items.map((pr) => <button key={pr.number} onClick={() => select(pr.number)} className={clsx("w-full text-left rounded p-3 hover:bg-bg-hover", detail?.pull_request.number === pr.number && "bg-bg-hover")}>
            <div className="text-sm font-medium line-clamp-2">{pr.draft && <span className="text-text-muted">[{t("pullRequests.draft")}] </span>}{pr.title}</div>
            <div className="text-xs text-text-muted mt-1">#{pr.number} {pr.author} · {pr.head} → {pr.base}</div>
          </button>)}
          {!loading && items.length === 0 && <p className="text-xs text-text-muted p-3">{t("pullRequests.empty")}</p>}
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-5">
        {detail ? <section className="max-w-4xl space-y-4">
          <div className="flex justify-between gap-3"><div><h2 className="text-xl font-semibold">{detail.pull_request.title}</h2><p className="text-xs text-text-muted">#{detail.pull_request.number} · {detail.pull_request.head} → {detail.pull_request.base}</p></div><button className="btn-secondary" onClick={() => checkout(detail.pull_request.number)}>{t("pullRequests.checkout")}</button></div>
          <div className="card p-4 whitespace-pre-wrap text-sm">{detail.pull_request.body || t("pullRequests.noDescription")}</div>
          <div className="card p-4"><h3 className="font-semibold mb-3">{t("pullRequests.checks")}</h3>{detail.checks.length ? detail.checks.map((check) => <div key={check.name} className="flex justify-between py-2 border-b last:border-0 border-border-subtle text-sm"><span>{check.name}</span><span className={clsx(check.conclusion === "success" ? "text-success" : check.conclusion ? "text-danger" : "text-text-muted")}>{check.conclusion || check.status}</span></div>) : <p className="text-sm text-text-muted">{t("pullRequests.noChecks")}</p>}</div>
          <button className="btn-secondary" onClick={() => setDetail(null)}>{t("pullRequests.new")}</button>
        </section> : <section className="max-w-3xl space-y-4">
          <h2 className="text-xl font-semibold">{t("pullRequests.new")}</h2>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs text-text-muted">{t("pullRequests.base")}<input className="input mt-1" value={base} onChange={(e) => setBase(e.target.value)} /></label><label className="text-xs text-text-muted">{t("pullRequests.head")}<input className="input mt-1" value={head} onChange={(e) => setHead(e.target.value)} /></label></div>
          <label className="text-xs text-text-muted">{t("pullRequests.prTitle")}<input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="text-xs text-text-muted">{t("pullRequests.description")}<textarea className="input mt-1 min-h-48 resize-y" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />{t("pullRequests.createDraft")}</label>
          <div className="flex gap-2"><button className="btn-secondary" onClick={generate} disabled={creating || !base || !head}>{t("pullRequests.aiGenerate")}</button><button className="btn-primary" onClick={create} disabled={creating || !title.trim() || !base || !head}>{creating ? t("common.loading") : t("pullRequests.create")}</button></div>
          <p className="text-xs text-text-muted">{t("pullRequests.browserFallback")}</p>
        </section>}
      </main>
    </div>
  );
}
