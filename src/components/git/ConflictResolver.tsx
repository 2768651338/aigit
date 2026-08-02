import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConflictFile } from "@/types";
import { gitService } from "@/services/git";
import { formatError } from "@/utils/error";
import { parseConflictBlocks, resolveConflictBlock } from "@/utils/conflict";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { openRepositoryFile } from "@/utils/openRepositoryFile";
import { AlertCircleIcon, SpinnerIcon, XIcon } from "@/components/common/Icons";

interface ConflictResolverProps {
  open: boolean;
  onClose: () => void;
}

export function ConflictResolver({ open, onClose }: ConflictResolverProps) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((state) => state.currentPath);
  const refreshMergeState = useRepoStore((state) => state.refreshMergeState);
  const refreshStatus = useRepoStore((state) => state.refreshStatus);
  const resolveOurs = useRepoStore((state) => state.resolveOurs);
  const resolveTheirs = useRepoStore((state) => state.resolveTheirs);
  const toast = useToastStore();
  const [files, setFiles] = useState<ConflictFile[]>([]);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!currentPath) return;
    setLoading(true);
    try {
      const next = await gitService.listConflictDetails(currentPath);
      setFiles(next);
      setSelected((value) => Math.min(value, Math.max(0, next.length - 1)));
    } catch (error) {
      toast.error(formatError(error), t("conflictResolver.title"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open, currentPath]);

  const file = files[selected];
  useEffect(() => {
    if (file) setResult(file.worktree_content ?? file.ours?.content ?? file.theirs?.content ?? "");
  }, [file]);

  const blocks = useMemo(() => parseConflictBlocks(result), [result]);

  if (!open) return null;

  const quickResolve = async (ours: boolean) => {
    if (!file) return;
    setSaving(true);
    try {
      if (ours) await resolveOurs([file.path]);
      else await resolveTheirs([file.path]);
      await load();
      toast.success(t("conflictResolver.saved"));
    } catch (error) {
      toast.error(formatError(error));
    } finally {
      setSaving(false);
    }
  };

  const openExternal = async () => {
    if (!currentPath || !file) return;
    try {
      await openRepositoryFile(currentPath, file.path);
    } catch (error) {
      toast.error(formatError(error));
    }
  };

  const save = async () => {
    if (!currentPath || !file) return;
    if (parseConflictBlocks(result).length > 0) {
      toast.error(t("conflictResolver.markersRemain"));
      return;
    }
    setSaving(true);
    try {
      await gitService.saveConflictResolution(currentPath, file.path, result);
      await Promise.all([refreshMergeState(), refreshStatus(true)]);
      await load();
      toast.success(t("conflictResolver.saved"));
    } catch (error) {
      toast.error(formatError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60" role="dialog" aria-modal="true" aria-label={t("conflictResolver.title")}>
      <div className="m-5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-base shadow-2xl">
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <h2 className="font-semibold">{t("conflictResolver.title")}</h2>
          <span className="text-xs text-text-muted">{t("conflictResolver.remaining", { count: files.length })}</span>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose} aria-label={t("common.close")}><XIcon size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-bg-surface p-2">
            {files.map((entry, index) => (
              <button key={entry.path} className={`mb-1 w-full rounded px-2 py-2 text-left text-xs ${index === selected ? "bg-accent/15 text-accent" : "hover:bg-bg-hover"}`} onClick={() => setSelected(index)}>
                <div className="truncate font-mono">{entry.path}</div>
                <div className="mt-1 text-2xs text-text-muted">{t(`conflictResolver.kind.${entry.kind}`)}</div>
              </button>
            ))}
            {!loading && files.length === 0 && <p className="p-3 text-xs text-text-muted">{t("conflictResolver.none")}</p>}
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-4">
            {loading && <div className="flex items-center gap-2 text-sm text-text-muted"><SpinnerIcon size={16} />{t("common.loading")}</div>}
            {file && (
              <div className="flex h-full min-h-[32rem] flex-col gap-3">
                {!file.can_edit_text ? (
                  <div className="rounded border border-warning/30 bg-warning/10 p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium text-warning"><AlertCircleIcon size={16} />{t(`conflictResolver.fallback.${file.fallback_reason}`)}</div>
                    <p className="text-text-secondary">{t("conflictResolver.fallbackHint")}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-2xs text-text-muted">
                      <span title={file.base?.oid}>{t("conflictResolver.base")}: {file.base?.path ?? "—"}</span>
                      <span title={file.ours?.oid}>{t("conflictResolver.ours")}: {file.ours?.path ?? t("conflictResolver.deleted")}</span>
                      <span title={file.theirs?.oid}>{t("conflictResolver.theirs")}: {file.theirs?.path ?? t("conflictResolver.deleted")}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" disabled={saving} onClick={() => void openExternal()}>{t("conflictResolver.openExternal")}</button><button className="btn-secondary" disabled={saving} onClick={() => quickResolve(true)}>{file.ours ? t("conflictResolver.keepOurs") : t("conflictResolver.deleteOurs")}</button><button className="btn-secondary" disabled={saving} onClick={() => quickResolve(false)}>{file.theirs ? t("conflictResolver.keepTheirs") : t("conflictResolver.deleteTheirs")}</button></div>
                  </div>
                ) : (
                  <>
                    <div className="grid min-h-40 grid-cols-3 gap-2">
                      <Stage title={t("conflictResolver.base")} content={file.base?.content} />
                      <Stage title={t("conflictResolver.ours")} content={file.ours?.content} />
                      <Stage title={t("conflictResolver.theirs")} content={file.theirs?.content} />
                    </div>
                    {blocks.length > 0 && <div className="flex flex-wrap gap-2 rounded border border-border bg-bg-surface p-2 text-xs"><span className="py-1 text-text-muted">{t("conflictResolver.blocks", { count: blocks.length })}</span>{blocks.map((_, index) => <div className="flex gap-1" key={index}><span className="py-1">#{index + 1}</span><button className="btn-ghost text-xs" onClick={() => setResult((value) => resolveConflictBlock(value, index, "ours"))}>{t("conflictResolver.takeOurs")}</button><button className="btn-ghost text-xs" onClick={() => setResult((value) => resolveConflictBlock(value, index, "theirs"))}>{t("conflictResolver.takeTheirs")}</button><button className="btn-ghost text-xs" onClick={() => setResult((value) => resolveConflictBlock(value, index, "both"))}>{t("conflictResolver.takeBoth")}</button></div>)}</div>}
                    <label className="flex min-h-0 flex-1 flex-col text-xs font-medium"><span className="mb-1">{t("conflictResolver.result")}</span><textarea aria-label={t("conflictResolver.result")} value={result} onChange={(event) => setResult(event.target.value)} spellCheck={false} className="input min-h-52 flex-1 resize-none whitespace-pre font-mono text-xs" /></label>
                    <div className="flex justify-end gap-2"><button className="btn-ghost" disabled={saving} onClick={() => quickResolve(true)}>{t("branches.resolveOurs")}</button><button className="btn-ghost" disabled={saving} onClick={() => quickResolve(false)}>{t("branches.resolveTheirs")}</button><button className="btn-primary" disabled={saving} onClick={save}>{saving && <SpinnerIcon size={14} />}{t("conflictResolver.saveStage")}</button></div>
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Stage({ title, content }: { title: string; content: string | null | undefined }) {
  const { t } = useTranslation();
  return <section className="flex min-w-0 flex-col overflow-hidden rounded border border-border"><h3 className="border-b border-border bg-bg-surface px-2 py-1.5 text-xs font-semibold">{title}</h3><pre className="flex-1 overflow-auto p-2 text-xs">{content ?? t("conflictResolver.missingStage")}</pre></section>;
}
