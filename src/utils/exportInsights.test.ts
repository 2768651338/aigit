import { describe, expect, it } from "vitest";
import { makeExportFileName, validateExportPath } from "./exportInsights";

describe("insights export", () => {
  it("creates safe names with the selected extension", () => expect(makeExportFileName("my/repo", "timeline", "gif")).toMatch(/my-repo-timeline-\d{4}-\d{2}-\d{2}\.gif/));
  it("does not allow unbounded frame constants", async () => { const module = await import("./insights"); expect(module.MAX_GIF_FRAMES).toBeLessThanOrEqual(120); expect(module.MAX_EXPORT_WIDTH).toBeLessThanOrEqual(2400); });
  it("accepts absolute dialog paths with the expected extension", () => {
    expect(validateExportPath("C:\\Users\\me\\report.md", "markdown")).toBe("C:\\Users\\me\\report.md");
    expect(validateExportPath("/tmp/report.PNG", "png")).toBe("/tmp/report.PNG");
  });
  it.each([
    ["report.md", "markdown"],
    ["C:\\tmp\\report.txt", "markdown"],
    ["C:\\tmp\\report.md\n.png", "png"],
  ] as const)("rejects unsafe or mismatched export path %s", (path, format) => {
    expect(() => validateExportPath(path, format)).toThrow();
  });
});
