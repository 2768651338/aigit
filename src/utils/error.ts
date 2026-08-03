import type { ErrorDto } from "@/types";

const CODE_HINTS: Record<string, string> = {
  ai_authentication: "请检查当前 AI 提供商的 API 密钥是否正确，并在设置中重新保存。",
  ai_rate_limited: "请求过于频繁，请稍后重试或检查服务商额度。",
  ai_timeout: "AI 请求超时，请检查网络后重试。",
  ai_network: "无法连接 AI 服务，请检查网络和服务地址后重试。",
  ai_upstream: "AI 服务暂时不可用，请稍后重试。",
  ai_context_exceeded: "输入超出模型上下文限制。请减少输入内容（如分批提交/审查），或在设置中调大“最大上下文 Token 数”。",
  ai_response_invalid: "AI 返回了无法解析的响应，请重试；若持续发生请反馈诊断 ID。",
  credential_error: "无法访问系统凭据存储，请检查系统凭据服务后重试。",
  config_error: "配置无效或无法保存，请检查设置后重试。",
  not_a_repository: "该路径不是有效的 Git 仓库，请重新选择仓库。",
};

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
  const hint = CODE_HINTS[error.code];
  if (hint && !error.message.includes(hint)) parts.push(hint);
  if (error.diagnostic_id) parts.push(`诊断 ID: ${error.diagnostic_id}`);
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
