import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

describe("sensitive-content confirmation copy", () => {
  it.each([
    ["en", en.common.secretsMessage],
    ["zh", zh.common.secretsMessage],
  ])("renders %s detail on separate lines", (_locale, message) => {
    expect(message).toContain("\n{{detail}}\n");
    expect(message).not.toContain("\\n");
  });
});
