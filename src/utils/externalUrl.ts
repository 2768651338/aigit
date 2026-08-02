import { openUrl } from "@tauri-apps/plugin-opener";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/**
 * Parse an external link and reject schemes that can execute or read local
 * content (for example javascript:, data:, file: and shell pseudo-URLs).
 */
export function safeExternalUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048 || /[\0\r\n]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Open a validated URL in the operating system's registered application. */
export async function openExternalUrl(value: string): Promise<boolean> {
  const url = safeExternalUrl(value);
  if (!url) return false;
  await openUrl(url);
  return true;
}
