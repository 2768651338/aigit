import { describe, it, expect } from "vitest";
import { buildIgnoreTargets, normalizeRepoPath } from "@/utils/gitignore";

describe("normalizeRepoPath", () => {
  it("converts Windows separators and strips redundant prefixes", () => {
    expect(normalizeRepoPath("src\\components\\a.ts")).toBe("src/components/a.ts");
    expect(normalizeRepoPath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeRepoPath("/src/a.ts/")).toBe("src/a.ts");
    expect(normalizeRepoPath("a.ts")).toBe("a.ts");
  });
});

describe("buildIgnoreTargets", () => {
  it("builds file / dir / parent patterns for a nested path", () => {
    expect(buildIgnoreTargets("src/components/Button.tsx")).toEqual({
      file: "/src/components/Button.tsx",
      dir: "/src/components/",
      parentDir: "/src/",
    });
  });

  it("returns null dir and parent for a repo-root file", () => {
    expect(buildIgnoreTargets("README.md")).toEqual({
      file: "/README.md",
      dir: null,
      parentDir: null,
    });
  });

  it("returns null parent when the file sits directly in a root directory", () => {
    expect(buildIgnoreTargets("docs/guide.md")).toEqual({
      file: "/docs/guide.md",
      dir: "/docs/",
      parentDir: null,
    });
  });

  it("normalizes Windows paths before deriving patterns", () => {
    expect(buildIgnoreTargets("vendor\\lib\\pkg\\index.js")).toEqual({
      file: "/vendor/lib/pkg/index.js",
      dir: "/vendor/lib/pkg/",
      parentDir: "/vendor/lib/",
    });
  });
});
