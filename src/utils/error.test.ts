import { describe, expect, it } from "vitest";
import { formatError, isErrorDto } from "@/utils/error";

describe("formatError", () => {
  it("formats structured errors with an actionable hint and diagnostic id", () => {
    const error = {
      code: "ai_authentication",
      message: "AI authentication failed",
      retryable: false,
      diagnostic_id: "diag-123",
    };

    expect(isErrorDto(error)).toBe(true);
    expect(formatError(error)).toBe(
      "AI authentication failed\n请检查当前 AI 提供商的 API 密钥是否正确，并在设置中重新保存。\n诊断 ID: diag-123"
    );
  });

  it("keeps legacy Error, string, and payload errors compatible", () => {
    expect(formatError(new Error("legacy failure"))).toBe("legacy failure");
    expect(formatError("plain failure")).toBe("plain failure");
    expect(formatError({ type: "Config", payload: "bad value" })).toBe(
      "Config: bad value"
    );
  });

  it("does not treat incomplete objects as ErrorDto", () => {
    expect(isErrorDto({ code: "ai_timeout", message: "timeout" })).toBe(false);
  });
});
