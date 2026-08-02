import { describe, expect, it } from "vitest";
import { buildHunkPatch } from "@/components/git/DiffViewer";
import type { FileDiff } from "@/types";

const renamedDiff: FileDiff = {
  path: "src/new name.ts",
  old_path: "src/old name.ts",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1 +1 @@",
      lines: [
        { content: "old", line_type: "delete", old_line_no: 1, new_line_no: null },
        { content: "new", line_type: "add", old_line_no: null, new_line_no: 1 },
        {
          content: " No newline at end of file",
          line_type: "no_newline",
          old_line_no: null,
          new_line_no: null,
        },
      ],
    },
  ],
};

describe("buildHunkPatch", () => {
  it("uses the rename source path and preserves no-newline markers", () => {
    const patch = buildHunkPatch(renamedDiff, 0);

    expect(patch).toContain("diff --git a/src/old name.ts b/src/new name.ts");
    expect(patch).toContain("--- a/src/old name.ts");
    expect(patch).toContain("+++ b/src/new name.ts");
    expect(patch).toContain("\\ No newline at end of file");
    expect(patch.endsWith("\n")).toBe(true);
  });

  it("recalculates counts when only selected lines are staged", () => {
    const patch = buildHunkPatch(
      renamedDiff,
      0,
      new Set(["src/new name.ts::0:1"]),
    );

    expect(patch).toContain("@@ -1,1 +1,2 @@");
    expect(patch).toContain(" old");
    expect(patch).toContain("+new");
    expect(patch).not.toContain("-old");
  });
});
