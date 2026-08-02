import { describe, expect, it } from "vitest";
import { isAbsoluteDirectory, isCloneUrlValid } from "@/components/git/RepoEntryDialog";

describe("repository entry validation", () => {
  it.each([
    "https://github.com/example/repo.git",
    "ssh://git@example.com/example/repo.git",
    "git://example.com/example/repo.git",
    "git@example.com:example/repo.git",
  ])("accepts supported clone URL %s", (url) => {
    expect(isCloneUrlValid(url)).toBe(true);
  });

  it.each(["", "github.com/example/repo", "https://example.com/repo\n--upload-pack=bad", "git@:repo"])(
    "rejects invalid clone URL %s",
    (url) => expect(isCloneUrlValid(url)).toBe(false),
  );

  it.each(["D:\\work\\repo", "C:/work/repo", "/work/repo", "\\\\server\\share\\repo"])(
    "accepts absolute directory %s",
    (path) => expect(isAbsoluteDirectory(path)).toBe(true),
  );

  it.each(["", "repo", ".\\repo", "work/repo"])("rejects relative directory %s", (path) => {
    expect(isAbsoluteDirectory(path)).toBe(false);
  });
});
