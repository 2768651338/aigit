import { useToastStore, type ToastType } from "@/stores/toastStore";
import { useTranslation } from "react-i18next";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  InfoIcon,
  XIcon,
} from "@/components/common/Icons";

const ICONS: Record<ToastType, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: AlertCircleIcon,
  info: InfoIcon,
};

const STYLES: Record<ToastType, string> = {
  success: "border-success/30 text-success",
  error: "border-danger/30 text-danger",
  info: "border-info/30 text-info",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const { t } = useTranslation();

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 bg-bg-elevated border rounded-md shadow-lg animate-toast-in ${STYLES[toast.type]}`}
            role="status"
          >
            <Icon size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {toast.title && (
                <div className="text-xs font-semibold text-text-primary mb-0.5">
                  {toast.title}
                </div>
              )}
              <div className="text-xs text-text-secondary break-words whitespace-pre-wrap">
                {toast.message}
              </div>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
              aria-label={t("common.dismiss")}
            >
              <XIcon size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
