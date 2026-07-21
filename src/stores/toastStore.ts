import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  /** Optional title shown above the message. */
  title?: string;
  /** Auto-dismiss timeout in ms. 0 means sticky (won't auto-dismiss). */
  duration: number;
}

interface ToastStoreState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  /** Convenience helpers. */
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

let nextId = 1;

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 3500,
  // Errors usually contain actionable detail; give users more time.
  error: 6000,
};

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = nextId++;
    const full: Toast = { id, ...toast };
    set((s) => ({ toasts: [...s.toasts, full] }));
    if (full.duration > 0) {
      window.setTimeout(() => {
        get().dismiss(id);
      }, full.duration);
    }
  },

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  success: (message, title) =>
    get().push({
      type: "success",
      message,
      title,
      duration: DEFAULT_DURATION.success,
    }),

  error: (message, title) =>
    get().push({
      type: "error",
      message,
      title,
      duration: DEFAULT_DURATION.error,
    }),

  info: (message, title) =>
    get().push({
      type: "info",
      message,
      title,
      duration: DEFAULT_DURATION.info,
    }),
}));
