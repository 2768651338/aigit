import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalAccessibility } from "@/utils/modalA11y";

interface InputDialogProps {
  open: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  /** Receives the trimmed value; only called when the input is non-empty. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Small modal for free-text input (rename, id entry, …). Replaces the
 * WebView's blocking `window.prompt`, which cannot be styled or localized.
 * Esc cancels, Enter confirms, the initial value is pre-selected.
 */
export function InputDialog({
  open,
  title,
  initialValue = "",
  placeholder,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(panelRef, onCancel, open);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, initialValue]);

  if (!open) return null;

  const confirm = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="input-dialog-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[400px] max-w-[90vw] rounded-lg border border-border bg-bg-surface shadow-xl p-5"
      >
        <h2 id="input-dialog-title" className="font-semibold mb-3">
          {title}
        </h2>
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
          }}
          placeholder={placeholder}
          className="w-full bg-bg-base border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-border-strong"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!value.trim()}
            onClick={confirm}
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
