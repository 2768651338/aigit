import { describe, expect, it } from "vitest";
import { parseConflictBlocks, resolveConflictBlock } from "./conflict";

const sample = [
  "before",
  "<<<<<<< HEAD",
  "ours",
  "||||||| base",
  "base",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "after",
].join("\n");

describe("conflict block helpers", () => {
  it("parses diff3 ours, base and theirs sections", () => {
    expect(parseConflictBlocks(sample)).toEqual([
      { start: 1, end: 7, ours: "ours", base: "base", theirs: "theirs" },
    ]);
  });

  it("resolves a block with either side or both", () => {
    expect(resolveConflictBlock(sample, 0, "ours")).toBe("before\nours\nafter");
    expect(resolveConflictBlock(sample, 0, "theirs")).toBe("before\ntheirs\nafter");
    expect(resolveConflictBlock(sample, 0, "both")).toBe("before\nours\ntheirs\nafter");
  });
});
