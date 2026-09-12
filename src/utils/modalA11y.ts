import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Modal dialog accessibility: Esc closes, initial focus moves into the
 * dialog, and Tab cycles within it instead of escaping to the background.
 *
 * Callers keep ownership of what "close" means (busy guards, confirm flows).
 * Attach `containerRef` to the element that contains every focusable control.
 */
export function useModalAccessibility(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    // Move initial focus into the dialog (first focusable, else the panel).
    const first = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? container)?.focus?.();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    // Capture phase so the trap wins over any other document key handlers.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, containerRef, onClose]);
}
