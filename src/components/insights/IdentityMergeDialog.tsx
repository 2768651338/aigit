import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalAccessibility } from "@/utils/modalA11y";
import type { AuthorAliasRule, ContributorInsights } from "@/types";

export function IdentityMergeDialog({ open, contributors, onClose, onSave }: { open: boolean; contributors: ContributorInsights[]; onClose: () => void; onSave: (rules: AuthorAliasRule[]) => void }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, onClose, open);
  const [selected, setSelected] = useState<string[]>([]); const [name, setName] = useState("");
  if (!open) return null;
  const save = () => { const display = name.trim(); if (!display || selected.length < 2) return; onSave(selected.map((email) => ({ email, display_name: display }))); setSelected([]); setName(""); };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="identity-title"><div ref={panelRef} tabIndex={-1} className="w-[440px] max-w-[90vw] rounded-lg border border-border bg-bg-surface p-5"><h2 id="identity-title" className="font-semibold mb-3">{t("insights.mergeIdentityTitle")}</h2><p className="text-xs text-text-muted mb-3">{t("insights.mergeIdentityHint")}</p><div className="max-h-56 overflow-auto space-y-2">{contributors.map((c) => <label key={c.email} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(c.email)} onChange={(e) => setSelected((v) => e.target.checked ? [...v, c.email] : v.filter((x) => x !== c.email))} /><span className="truncate">{c.name} <span className="text-text-muted">({c.email})</span></span></label>)}</div><input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-4 bg-bg-base border border-border rounded px-3 py-2 text-sm" placeholder={t("insights.mergeDisplayNamePlaceholder")} /><div className="flex justify-end gap-2 mt-4"><button type="button" onClick={onClose} className="px-3 py-1.5 text-sm">{t("common.cancel")}</button><button type="button" onClick={save} disabled={selected.length < 2 || !name.trim()} className="px-3 py-1.5 text-sm rounded bg-accent text-white disabled:opacity-50">{t("insights.saveMerge")}</button></div></div></div>;
}
