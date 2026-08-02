import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { confirmDialog } from "@/utils/dialog";
import {
  CheckIcon,
  DownloadIcon,
  GitBranchIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  SpinnerIcon,
  TrashIcon,
  XIcon,
} from "@/components/common/Icons";

interface RemoteForm {
  oldName?: string;
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export function RemotePanel() {
  const { t } = useTranslation();
  const {
    currentPath, branches, remotes, tracking, fetchUpdatedAt, remoteBusy: busy,
    remoteTask: runningTask, loadRemoteState, setRemoteBusy, setRemoteError,
    setRemoteTask, refreshBranches, refreshLog, refreshRepoInfo, refreshStatus,
  } = useRepoStore();
  const toast = useToastStore();
  const [form, setForm] = useState<RemoteForm | null>(null);
  const [selectedRemote, setSelectedRemote] = useState("");
  const [upstreamBranch, setUpstreamBranch] = useState("");
  const [trackingRemoteBranch, setTrackingRemoteBranch] = useState("");
  const [trackingLocalName, setTrackingLocalName] = useState("");
  const [prune, setPrune] = useState(true);
  const [tags, setTags] = useState(true);

  const remoteBranches = useMemo(
    () => branches.filter((branch) => branch.is_remote && (!selectedRemote || branch.name.startsWith(`${selectedRemote}/`))),
    [branches, selectedRemote],
  );

  const load = useCallback(async () => {
    if (!currentPath) return;
    await loadRemoteState(currentPath);
  }, [currentPath, loadRemoteState]);

  useEffect(() => {
    if (!tracking) return;
    setSelectedRemote((current) => current || tracking.remote || remotes[0]?.name || "");
    setUpstreamBranch((current) => current || tracking.remote_branch || tracking.branch);
  }, [remotes, tracking]);

  useEffect(() => {
    void load().catch((e) => toast.error(formatError(e), t("remotes.loadFailed")));
  }, [load, t, toast]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (!currentPath) return;
    const path = currentPath;
    setRemoteBusy(path, key);
    setRemoteError(path, null);
    try {
      await action();
      await loadRemoteState(path);
      toast.success(success);
    } catch (e) {
      const message = formatError(e);
      setRemoteError(path, message);
      toast.error(message, t("remotes.operationFailed"));
    } finally {
      setRemoteBusy(path, null);
    }
  };

  const runTask = async (
    key: "fetch" | "pull" | "push",
    action: (path: string, taskId: string) => Promise<unknown>,
    refresh: (path: string) => Promise<unknown>,
    success: string,
  ) => {
    if (!currentPath) return;
    const path = currentPath;
    const task = {
      key,
      id: `remote:${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    };
    setRemoteTask(path, task);
    setRemoteError(path, null);
    try {
      await action(path, task.id);
      await refresh(path);
      await loadRemoteState(path, key === "fetch");
      toast.success(success);
    } catch (e) {
      const message = formatError(e);
      setRemoteError(path, message);
      toast.error(message, t("remotes.operationFailed"));
    } finally {
      if (useRepoStore.getState().tabs[path]?.remoteTask?.id === task.id) {
        setRemoteTask(path, null);
      }
    }
  };

  const cancelTask = async () => {
    if (!runningTask) return;
    try {
      await gitService.cancelGitTask(runningTask.id);
    } catch (e) {
      toast.error(formatError(e), t("remotes.operationFailed"));
    }
  };

  const saveRemote = async () => {
    if (!currentPath || !form?.name.trim() || !form.fetchUrl.trim() || !form.pushUrl.trim()) return;
    const name = form.name.trim();
    const fetchUrl = form.fetchUrl.trim();
    const pushUrl = form.pushUrl.trim();
    await run("save", async () => {
      if (!form.oldName) {
        await gitService.addRemote(currentPath, name, fetchUrl);
      } else if (form.oldName !== name) {
        await gitService.renameRemote(currentPath, form.oldName, name);
      }
      await gitService.setRemoteUrl(currentPath, name, fetchUrl, false);
      await gitService.setRemoteUrl(currentPath, name, pushUrl, true);
    }, t(form.oldName ? "remotes.updated" : "remotes.added", { name }));
    setForm(null);
  };

  const removeRemote = async (name: string) => {
    if (!currentPath) return;
    if (!await confirmDialog(t("remotes.removeTitle"), t("remotes.removeConfirm", { name }), "warning")) return;
    await run("remove", () => gitService.removeRemote(currentPath, name), t("remotes.removed", { name }));
  };

  const fetchRemote = () => currentPath && void runTask(
    "fetch",
    (path, taskId) => gitService.fetchTask(path, taskId, selectedRemote || undefined, prune, tags),
    async () => undefined,
    t("remotes.fetchSuccess"),
  );

  const pull = () => currentPath && void runTask(
    "pull",
    (path, taskId) => gitService.pullTask(path, taskId),
    () => Promise.all([refreshStatus(true), refreshBranches(true), refreshLog(true), refreshRepoInfo()]),
    t("remotes.pullSuccess"),
  );

  const push = () => currentPath && void runTask(
    "push",
    (path, taskId) => gitService.pushTask(
      path,
      taskId,
      tracking?.upstream ? undefined : selectedRemote,
      tracking?.upstream ? undefined : upstreamBranch.trim(),
    ),
    () => Promise.all([refreshBranches(true), refreshRepoInfo()]),
    t("remotes.pushSuccess"),
  );

  const setUpstream = () => currentPath && selectedRemote && upstreamBranch.trim() && run(
    "upstream",
    () => gitService.setUpstream(currentPath, selectedRemote, upstreamBranch.trim()),
    t("remotes.upstreamSet"),
  );

  const createTracking = () => currentPath && trackingRemoteBranch && run(
    "tracking",
    async () => {
      await gitService.createTrackingBranch(currentPath, trackingRemoteBranch, trackingLocalName.trim() || undefined);
      await Promise.all([refreshStatus(true), refreshBranches(true), refreshLog(true), refreshRepoInfo()]);
      setTrackingLocalName("");
    },
    t("remotes.trackingCreated"),
  );

  if (!currentPath) return null;
  const taskBusy = !!runningTask;

  return (
    <div className="border-b border-border bg-bg-elevated">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle">
        <GitBranchIcon size={15} />
        <strong className="text-sm">{t("remotes.title")}</strong>
        <span className="text-2xs text-text-muted">
          {tracking?.upstream
            ? t("remotes.tracking", { branch: tracking.branch, upstream: tracking.upstream })
            : t("remotes.noUpstream", { branch: tracking?.branch ?? "" })}
        </span>
        {tracking?.upstream && <span className="text-2xs text-text-muted">{t("remotes.aheadBehind", { ahead: tracking.ahead, behind: tracking.behind })}</span>}
        <div className="flex-1" />
        {taskBusy && <span className="text-2xs text-accent">{t(`remotes.running.${runningTask.key}`)}</span>}
        {fetchUpdatedAt && <span className="text-2xs text-text-muted">{t("remotes.updatedAt", { time: new Date(fetchUpdatedAt).toLocaleTimeString() })}</span>}
        <button className="btn-ghost" onClick={() => void load()} aria-label={t("changes.refresh")}><RefreshIcon size={14} /></button>
        <button className="btn-ghost" onClick={() => setForm({ name: "", fetchUrl: "", pushUrl: "" })} aria-label={t("remotes.add")}><PlusIcon size={14} /></button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
        <select className="input w-36 py-1.5" value={selectedRemote} onChange={(e) => setSelectedRemote(e.target.value)}>
          <option value="">{t("remotes.allRemotes")}</option>
          {remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} />{t("remotes.prune")}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} />{t("remotes.tags")}</label>
        <button className="btn-secondary" disabled={taskBusy || !!busy} onClick={fetchRemote}>{runningTask?.key === "fetch" ? <SpinnerIcon size={13} /> : <RefreshIcon size={13} />}{t("remotes.fetch")}</button>
        <button className="btn-secondary" disabled={taskBusy || !!busy || !tracking?.upstream} onClick={pull}>{runningTask?.key === "pull" ? <SpinnerIcon size={13} /> : <DownloadIcon size={13} />}{t("remotes.pull")}</button>
        <button className="btn-secondary" disabled={taskBusy || !!busy || (!tracking?.upstream && (!selectedRemote || !upstreamBranch.trim()))} onClick={push}>{runningTask?.key === "push" ? <SpinnerIcon size={13} /> : <SendIcon size={13} />}{t("remotes.push")}</button>
        {taskBusy && <button className="btn-ghost text-danger" onClick={() => void cancelTask()}><XIcon size={13} />{t("remotes.cancel")}</button>}
        {!tracking?.upstream && <><input className="input w-40 py-1.5" value={upstreamBranch} onChange={(e) => setUpstreamBranch(e.target.value)} placeholder={t("remotes.remoteBranch")} /><button className="btn-primary" disabled={taskBusy || !!busy || !selectedRemote || !upstreamBranch.trim()} onClick={setUpstream}>{busy === "upstream" ? <SpinnerIcon size={13} /> : <CheckIcon size={13} />}{t("remotes.setUpstream")}</button></>}
      </div>

      {remoteBranches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2 text-xs">
          <span className="text-text-muted">{t("remotes.createTracking")}</span>
          <select className="input min-w-48 py-1.5" value={trackingRemoteBranch} onChange={(e) => setTrackingRemoteBranch(e.target.value)}>
            <option value="">{t("remotes.chooseRemoteBranch")}</option>
            {remoteBranches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
          </select>
          <input className="input w-40 py-1.5" value={trackingLocalName} onChange={(e) => setTrackingLocalName(e.target.value)} placeholder={t("remotes.localBranchOptional")} />
          <button className="btn-secondary" disabled={taskBusy || !!busy || !trackingRemoteBranch} onClick={createTracking}>{busy === "tracking" ? <SpinnerIcon size={13} /> : <GitBranchIcon size={13} />}{t("remotes.create")}</button>
        </div>
      )}

      {(form || remotes.length > 0) && (
        <div className="px-4 pb-2.5 space-y-1.5">
          {form && <div className="grid grid-cols-[9rem_1fr_1fr_auto_auto] gap-2"><input className="input py-1.5 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("remotes.name")} /><input className="input py-1.5 text-xs" value={form.fetchUrl} onChange={(e) => setForm({ ...form, fetchUrl: e.target.value })} placeholder={t("remotes.fetchUrl")} /><input className="input py-1.5 text-xs" value={form.pushUrl} onChange={(e) => setForm({ ...form, pushUrl: e.target.value })} placeholder={t("remotes.pushUrl")} /><button className="btn-primary" onClick={saveRemote} disabled={busy === "save"}><CheckIcon size={13} /></button><button className="btn-ghost" onClick={() => setForm(null)}><XIcon size={13} /></button></div>}
          {remotes.map((remote) => <div key={remote.name} className="flex items-center gap-2 text-xs group"><button className="font-mono text-text-primary hover:underline" onClick={() => setForm({ oldName: remote.name, name: remote.name, fetchUrl: remote.fetch_url, pushUrl: remote.push_url })}>{remote.name}</button><span className="text-text-muted truncate flex-1" title={remote.fetch_url}>{t("remotes.fetchUrl")}: {remote.fetch_url}</span><span className="text-text-muted truncate flex-1" title={remote.push_url}>{t("remotes.pushUrl")}: {remote.push_url}</span><button className="opacity-0 group-hover:opacity-100 text-danger" onClick={() => removeRemote(remote.name)} aria-label={t("remotes.remove", { name: remote.name })}><TrashIcon size={13} /></button></div>)}
        </div>
      )}
    </div>
  );
}
