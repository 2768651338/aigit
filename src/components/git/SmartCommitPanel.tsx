import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommitPlan, StageGroupResult } from "@/types";
import { aiService } from "@/services/ai";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import { useToastStore } from "@/stores/toastStore";
import { formatError } from "@/utils/error";
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, SpinnerIcon } from "@/components/common/Icons";

export function SmartCommitPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const currentPath = useRepoStore((state) => state.currentPath);
  const refreshStatus = useRepoStore((state) => state.refreshStatus);
  const refreshLog = useRepoStore((state) => state.refreshLog);
  const toast = useToastStore();
  const [plan, setPlan] = useState<CommitPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [staged, setStaged] = useState<Record<string, StageGroupResult>>({});
  const [recovery, setRecovery] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!currentPath) return;
    let active = true;
    setLoading(true);
    aiService.generateSmartCommitPlan(currentPath)
      .then((value) => {
        if (!active) return;
        setPlan(value);
        setExpanded(value.groups[0]?.id ?? null);
      })
      .catch((error) => active && toast.error(formatError(error), t("smartCommit.generateFailed")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [currentPath, t, toast]);

  const validate = async () => {
    if (!currentPath || !plan) return false;
    try {
      await gitService.validateSmartCommitPlan(currentPath, plan);
      return true;
    } catch (error) {
      setStale(true);
      setRecovery(formatError(error));
      return false;
    }
  };

  const stageGroup = async (groupId: string) => {
    if (!currentPath || !plan || !(await validate())) return;
    setBusyGroup(groupId);
    setRecovery(null);
    try {
      const result = await gitService.stageSmartCommitGroup(currentPath, plan, groupId);
      setStaged((value) => ({ ...value, [groupId]: result }));
      setRecovery(result.recovery);
      await refreshStatus(true);
    } catch (error) {
      setRecovery(formatError(error));
    } finally {
      setBusyGroup(null);
    }
  };

  const commitGroup = async (groupId: string) => {
    if (!currentPath || !plan || !staged[groupId]) return;
    if (!window.confirm(t("smartCommit.commitConfirm"))) return;
    setBusyGroup(groupId);
    setRecovery(null);
    try {
      const result = await gitService.commitSmartCommitGroup(
        currentPath,
        plan,
        groupId,
        staged[groupId].staged_tree,
      );
      setPlan(result.plan);
      setStaged({});
      setRecovery(result.recovery);
      await refreshStatus(true);
      await refreshLog(true);
      toast.success(t("smartCommit.groupCommitted"));
    } catch (error) {
      setRecovery(formatError(error));
    } finally {
      setBusyGroup(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-4 text-sm"><SpinnerIcon size={16} />{t("smartCommit.generating")}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-bg-base">
      <div className="flex items-center border-b border-border px-4 py-3">
        <div>
          <h3 className="font-semibold">{t("smartCommit.title")}</h3>
          <p className="text-xs text-text-muted">{t("smartCommit.explicitHint")}</p>
        </div>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
      {(plan?.warning || stale || recovery) && (
        <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-3 text-xs text-text-secondary">
          <AlertCircleIcon size={15} className="shrink-0" />
          <span className="whitespace-pre-wrap">{recovery ?? plan?.warning}</span>
        </div>
      )}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {plan?.groups.map((group, index) => {
          const isExpanded = expanded === group.id;
          const isBusy = busyGroup === group.id;
          const isCommitted = Boolean(group.committed_hash);
          const stagedResult = staged[group.id];
          return (
            <section key={group.id} className="rounded-lg border border-border bg-bg-surface">
              <button className="flex w-full items-start gap-2 p-3 text-left" onClick={() => setExpanded(isExpanded ? null : group.id)}>
                {isExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-muted">{t("smartCommit.group", { index: index + 1 })}</div>
                  <div className="font-mono text-sm text-text-primary">{group.message}</div>
                  <div className="mt-1 text-xs text-text-secondary">{group.reason}</div>
                </div>
                {isCommitted && <span className="text-xs text-success"><CheckIcon size={13} /> {t("smartCommit.committed")}</span>}
              </button>
              {isExpanded && (
                <div className="border-t border-border px-3 py-3">
                  <div className="mb-2 text-xs font-semibold text-text-muted">{t("smartCommit.hunks", { count: group.selections.length })}</div>
                  <div className="space-y-2">
                    {group.selections.map((selection) => (
                      <details key={selection.id} className="rounded border border-border-subtle bg-bg-base">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-mono">
                          {selection.file_path} · {selection.hunk_header}
                          {selection.fallback_reason && <span className="ml-2 text-warning">{t("smartCommit.fallback", { reason: selection.fallback_reason })}</span>}
                        </summary>
                        <pre className="max-h-64 overflow-auto whitespace-pre p-3 text-2xs text-text-secondary">{selection.patch}</pre>
                      </details>
                    ))}
                  </div>
                  {!isCommitted && (
                    <div className="mt-3 flex justify-end gap-2">
                      {!stagedResult ? (
                        <button className="btn-secondary" disabled={isBusy || stale || plan.existing_staged} onClick={() => void stageGroup(group.id)}>
                          {isBusy && <SpinnerIcon size={14} />}{t("smartCommit.stageGroup")}
                        </button>
                      ) : (
                        <button className="btn-primary" disabled={isBusy} onClick={() => void commitGroup(group.id)}>
                          {isBusy && <SpinnerIcon size={14} />}{t("smartCommit.confirmCommit")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {plan && <div className="border-t border-border px-4 py-2 text-2xs text-text-muted font-mono">HEAD {plan.snapshot.head.slice(0, 8)} · index {plan.snapshot.index_tree.slice(0, 8)} · diff {plan.snapshot.diff_hash}</div>}
    </div>
  );
}
