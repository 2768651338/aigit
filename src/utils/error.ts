/**
 * 格式化各种错误对象为可读字符串。
 * 处理 Tauri IPC 错误（可能是对象）、Error 实例、字符串等。
 */
export function formatError(e: unknown): string {
  if (e === null || e === undefined) {
    return "Unknown error";
  }

  // Tauri v2 IPC 错误通常是一个对象，可能包含 message 字段
  if (typeof e === "object") {
    // 尝试常见的错误字段
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") {
      return obj.message;
    }
    if (typeof obj.error === "string") {
      return obj.error;
    }
    // Tauri 序列化的 AppError 可能直接是一个枚举变体字符串
    if (typeof obj.type === "string" && typeof obj.payload !== "undefined") {
      return `${obj.type}: ${formatError(obj.payload)}`;
    }
    // 尝试 JSON 序列化
    try {
      const json = JSON.stringify(e);
      // 如果是简单对象，JSON 字符串可能很短
      if (json.length < 500) {
        return json;
      }
    } catch {
      // JSON 序列化失败，忽略
    }
  }

  return String(e);
}
