import type { ErrorDto } from "@/types";
import i18n from "@/i18n";

export function isErrorDto(value: unknown): value is ErrorDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean" &&
    (candidate.diagnostic_id === undefined ||
      candidate.diagnostic_id === null ||
      typeof candidate.diagnostic_id === "string")
  );
}

function formatErrorDto(error: ErrorDto): string {
  const parts = [error.message];
  // Hints live in the i18n `errors.*` namespace; unknown codes stay silent.
  const hint = i18n.t(`errors.${error.code}`, { defaultValue: "" });
  if (hint && !error.message.includes(hint)) parts.push(hint);
  if (error.diagnostic_id) {
    parts.push(`${i18n.t("errors.diagnosticId")}: ${error.diagnostic_id}`);
  }
  return parts.join("\n");
}

/** Format structured Tauri errors while remaining compatible with legacy errors. */
export function formatError(e: unknown): string {
  if (e === null || e === undefined) return "Unknown error";
  if (isErrorDto(e)) return formatErrorDto(e);

  if (typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.type === "string" && typeof obj.payload !== "undefined") {
      return `${obj.type}: ${formatError(obj.payload)}`;
    }
    try {
      const json = JSON.stringify(e);
      if (json.length < 500) return json;
    } catch {
      // Fall through to String for non-serializable legacy errors.
    }
  }

  return String(e);
}
