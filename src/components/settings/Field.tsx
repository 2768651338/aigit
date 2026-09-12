import type { ReactNode } from "react";

/** Shared labeled row wrapper used across the settings sections. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}
