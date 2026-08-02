import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternalUrl, safeExternalUrl } from "./externalUrl";

describe("external URL boundary", () => {
  it.each([
    ["https://example.com/path", "https://example.com/path"],
    ["http://localhost:11434/", "http://localhost:11434/"],
    ["mailto:security@example.com", "mailto:security@example.com"],
  ])("allows explicit external protocol %s", (input, expected) => {
    expect(safeExternalUrl(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/win.ini",
    "https://example.com\nfile:///tmp/a",
    "/relative/path",
  ])("rejects unsafe external URL %s", (input) => {
    expect(safeExternalUrl(input)).toBeNull();
  });

  it("opens only the normalized validated URL", async () => {
    expect(await openExternalUrl("https://example.com")).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/");
    expect(await openExternalUrl("javascript:alert(1)")).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
});
