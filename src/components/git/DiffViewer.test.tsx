import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";
import type { FileDiff } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const store = vi.hoisted(() => ({
  applyPatchToIndex: vi.fn(),
  applyPatchToIndexReverse: vi.fn(),
}));
vi.mock("@/stores/repoStore", () => ({ useRepoStore: () => store }));
vi.mock("@/stores/toastStore", () => ({
  useToastStore: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function makeFile(path: string, addedLine: string): FileDiff {
  return {
    path,
    old_path: null,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -0,0 +1 @@",
        lines: [
          {
            content: addedLine,
            line_type: "add",
            old_line_no: null,
            new_line_no: 1,
          },
        ],
      },
    ],
  };
}

const files: FileDiff[] = [
  makeFile("src/a.ts", "export const a = 1;"),
  makeFile("README.md", "# hello"),
];

describe("DiffViewer collapse behavior", () => {
  it("expands every file by default", () => {
    render(<DiffViewer diffs={files} mode="view" />);
    expect(screen.getByText("export const a = 1;")).not.toBeNull();
    expect(screen.getByText("# hello")).not.toBeNull();
  });

  it("starts fully collapsed with defaultCollapsed and re-collapses when diffs change", () => {
    const { rerender } = render(
      <DiffViewer diffs={files} mode="view" defaultCollapsed />,
    );

    // Collapsed headers still list every changed file…
    expect(screen.getByText("src/a.ts")).not.toBeNull();
    expect(screen.getByText("README.md")).not.toBeNull();
    // …but no diff lines are rendered.
    expect(screen.queryByText("export const a = 1;")).toBeNull();

    // Expanding one file reveals its lines.
    const expandButtons = screen.getAllByRole("button", { name: "diff.expand" });
    expect(expandButtons).toHaveLength(2);
    const headerA = expandButtons.find((el) =>
      el.textContent?.includes("src/a.ts"),
    )!;
    expect(headerA.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(headerA);
    expect(screen.getByText("export const a = 1;")).not.toBeNull();

    // A fresh diffs array (e.g. another commit selected) re-collapses all.
    rerender(<DiffViewer diffs={[...files]} mode="view" defaultCollapsed />);
    expect(screen.queryByText("export const a = 1;")).toBeNull();
    expect(screen.getAllByRole("button", { name: "diff.expand" })).toHaveLength(2);
  });
});
