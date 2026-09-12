import { confirmDialog } from "@/utils/dialog";
import { isErrorDto, formatError } from "@/utils/error";
import i18n from "@/i18n";

/**
 * Run a cloud-AI request, and when the backend blocks it because the payload
 * contains secret-like content (`ai_sensitive_content`), ask the user before
 * retrying once with `confirmSecrets = true`. Any other error, or a declined
 * confirmation, propagates unchanged so existing error reporting keeps working.
 */
export async function withSecretsConfirmation<T>(
  send: (confirmSecrets: boolean) => T | Promise<T>
): Promise<T> {
  try {
    return await send(false);
  } catch (e) {
    if (!isErrorDto(e) || e.code !== "ai_sensitive_content") throw e;
    const confirmed = await confirmDialog(
      i18n.t("common.secretsTitle"),
      i18n.t("common.secretsMessage", { detail: formatError(e) })
    );
    if (!confirmed) throw e;
    return send(true);
  }
}
