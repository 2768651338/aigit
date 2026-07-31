import { describe, expect, it } from "vitest";
import { makeExportFileName } from "./exportInsights";

describe("insights export", () => {
  it("creates safe names with the selected extension", () => expect(makeExportFileName("my/repo", "timeline", "gif")).toMatch(/my-repo-timeline-\d{4}-\d{2}-\d{2}\.gif/));
  it("does not allow unbounded frame constants", async () => { const module = await import("./insights"); expect(module.MAX_GIF_FRAMES).toBeLessThanOrEqual(120); expect(module.MAX_EXPORT_WIDTH).toBeLessThanOrEqual(2400); });
});
