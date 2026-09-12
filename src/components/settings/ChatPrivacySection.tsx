import { useTranslation } from "react-i18next";
import { useAiStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { confirmDialog } from "@/utils/dialog";
import { TrashIcon } from "@/components/common/Icons";

/**
 * "Local chat privacy" settings section. Fully self-contained: it reads the
 * chat store directly, so the parent view only needs to render it.
 */
export function ChatPrivacySection() {
  const { t } = useTranslation();
  const toast = useToastStore();
  const localSaveEnabled = useAiStore((s) => s.localSaveEnabled);
  const setLocalSaveEnabled = useAiStore((s) => s.setLocalSaveEnabled);
  const clearAllHistory = useAiStore((s) => s.clearAllHistory);

  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.chatPrivacy")}</h3>
      <p className="text-xs text-text-muted mb-4">{t("settings.chatPrivacyHint")}</p>
      <label className="flex items-center gap-2.5 cursor-pointer mb-4">
        <input type="checkbox" checked={localSaveEnabled} onChange={(e) => setLocalSaveEnabled(e.target.checked)} className="accent-accent w-4 h-4" />
        <span className="text-sm text-text-secondary">{t("settings.saveChatLocally")}</span>
      </label>
      <button type="button" className="btn-secondary text-danger" onClick={() => { void confirmDialog(t("common.confirmAction"), t("settings.clearChatConfirm")).then((confirmed) => { if (confirmed) void clearAllHistory().then(() => toast.success(t("settings.chatCleared"))); }); }}>
        <TrashIcon size={14} /> {t("settings.clearChatHistory")}
      </button>
    </section>
  );
}
