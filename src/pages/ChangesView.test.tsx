import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — hoisted before the component import so the real Tauri-only store
// and services are never loaded. The repo store is replaced with a plain
// in-memory state object the tests fully control.
// ---------------------------------------------------------------------------
const { mockRepoState, mockSettingsState } = vi.hoisted(() => {
  const noop = () => {};
  const noopAsync = () => Promise.resolve();
  return {
    mockRepoState: {
      currentPath: "D:/test/repo",
      selectedFile: null as string | null,
      workdirDiff: [] as import("@/types").FileDiff[],
      stagedDiff: [] as import("@/types").FileDiff[],
      fileStatuses: [],
      repoInfo: {
        path: "D:/test/repo",
        name: "repo",
        current_branch: "main",
        ahead: 0,
        behind: 0,
        head_hash: null,
      },
      commitMessage: "",
      aiError: null,
      pushError: null,
      aiLoading: false,
      committing: false,
      commitAndPushing: false,
      pushing: false,
      pulling: false,
      refreshing: false,
      loading: false,
      error: null,
      // Actions used anywhere in the rendered subtree are no-ops.
      stageAll: noopAsync,
      unstageFiles: noopAsync,
      stageFiles: noopAsync,
      discardFiles: noopAsync,
      commit: noopAsync,
      amend: noopAsync,
      push: noopAsync,
      pull: noopAsync,
      refreshStatus: noopAsync,
      selectFile: noopAsync,
      clearError: noop,
      setCommitMessage: noop,
      setPushError: noop,
      setAiError: noop,
      setAiLoading: noop,
      setCommitting: noop,
      setCommitAndPushing: noop,
      setPushing: noop,
      setPulling: noop,
      setCommitMessageFor: noop,
      setAiErrorFor: noop,
      setAiLoadingFor: noop,
      applyPatchToIndex: noopAsync,
      applyPatchToIndexReverse: noopAsync,
    },
    mockSettingsState: {
      config: { ui: { show_diff_inline: true } },
    },
  };
});

vi.mock("@/stores/repoStore", () => ({
  useRepoStore: Object.assign(
    vi.fn((selector?: (s: typeof mockRepoState) => unknown) =>
      selector ? selector(mockRepoState) : mockRepoState,
    ),
    { getState: () => mockRepoState, setState: () => {} },
  ),
}) as unknown as never);

vi.mock("@/stores/aiStore", () => ({
  useSettingsStore: vi.fn((selector?: (s: typeof mockSettingsState) => unknown) =>
    selector ? selector(mockSettingsState) : mockSettingsState,
  ),
  useAiStore: vi.fn(() => ({ generateCommitMessage: vi.fn() })),
}) as unknown as never);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }) as unknown as never);

import { ChangesView } from "@/pages/ChangesView";
import { ContextMenuProvider } from "@/components/common/ContextMenu";

const HEIGHT_KEY = "aigit:commitPanelHeight";

function renderView() {
  return render(
    <ContextMenuProvider>
      <ChangesView />
    </ContextMenuProvider>,
  );
}

/** The resizable commit-panel container (the div with an inline height). */
function getPanel(container: HTMLElement): HTMLElement {
  const handle = container.querySelector('[role="separator"]');
  if (!handle) throw new Error("resize handle not found");
  const panel = handle.parentElement;
  if (!panel) throw new Error("panel container not found");
  return panel;
}

function getHandle(panel: HTMLElement): HTMLElement {
  const h = panel.querySelector<HTMLElement>('[role="separator"]');
  if (!h) throw new Error("handle not found");
  return h;
}

/**
 * jsdom has no layout engine, so offsetHeight / getBoundingClientRect are 0.
 * The drag handler reads these to bound the resize, so stub them to mirror the
 * rendered inline height and a generous column height.
 */
function stubLayout(panel: HTMLElement, columnHeight: number) {
  Object.defineProperty(panel, "offsetHeight", {
    configurable: true,
    get: () => {
      const h = parseFloat(panel.style.height || "0");
      return Number.isFinite(h) && h > 0 ? h : 288;
    },
  });
  const column = panel.parentElement as HTMLElement;
  column.getBoundingClientRect = (() =>
    ({
      height: columnHeight,
      width: 1280,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: columnHeight,
      toJSON: () => ({}),
    }) as DOMRect) as typeof column.getBoundingClientRect;
}

/** Simulates a vertical drag of the resize handle. */
function drag(panel: HTMLElement, fromY: number, toY: number) {
  const handle = getHandle(panel);
  fireEvent.mouseDown(handle, { clientY: fromY });
  // mousemove/mouseup listeners are attached to `document`; dispatch on body
  // so the events bubble up to the document-level listeners.
  fireEvent.mouseMove(document.body, { clientY: toY });
  fireEvent.mouseUp(document.body);
}

beforeEach(() => {
  localStorage.clear();
  mockRepoState.selectedFile = null;
  mockRepoState.workdirDiff = [];
  mockRepoState.stagedDiff = [];
  mockSettingsState.config.ui.show_diff_inline = true;
});

describe("ChangesView resizable commit panel", () => {
  it("renders a drag handle above the commit textarea", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    const handle = getHandle(panel);
    expect(handle.getAttribute("role")).toBe("separator");
    const textarea = panel.querySelector("textarea");
    expect(textarea).not.toBeNull();
    // The textarea is the commit message input and fills the panel's leftover
    // space, so resizing the panel resizes the input box.
    expect(textarea?.className).toContain("flex-1");
  });

  it("starts at the default 288px height", () => {
    const { container } = renderView();
    expect(getPanel(container).style.height).toBe("288px");
  });

  it("grows the panel (and thus the input box) when dragged upward", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    stubLayout(panel, 800);
    drag(panel, 500, 400); // up 100px
    expect(panel.style.height).toBe("388px");
    expect(localStorage.getItem(HEIGHT_KEY)).toBe("388");
  });

  it("shrinks the panel (and thus the input box) when dragged downward", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    stubLayout(panel, 800);
    drag(panel, 500, 600); // down 100px
    expect(panel.style.height).toBe("188px");
  });

  it("clamps to the minimum height on a large downward drag", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    stubLayout(panel, 800);
    drag(panel, 500, 1500); // down 1000px -> would be -712 -> clamp 160
    expect(panel.style.height).toBe("160px");
  });

  it("clamps to the max height (column minus file-list reserve) on a large upward drag", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    stubLayout(panel, 800); // max = max(160, 800 - 80) = 720
    drag(panel, 500, -500); // up 1000px -> would be 1288 -> clamp 720
    expect(panel.style.height).toBe("720px");
  });

  it("double-click resets the height to the default 288px", () => {
    const { container } = renderView();
    const panel = getPanel(container);
    stubLayout(panel, 800);
    drag(panel, 500, 400); // -> 388
    expect(panel.style.height).toBe("388px");
    fireEvent.dblClick(getHandle(panel));
    expect(panel.style.height).toBe("288px");
  });

  it("restores the persisted height on remount (simulating reload)", () => {
    localStorage.setItem(HEIGHT_KEY, "440");
    const { container, unmount } = renderView();
    expect(getPanel(container).style.height).toBe("440px");
    unmount();
    const { container: container2 } = renderView();
    expect(getPanel(container2).style.height).toBe("440px");
  });

  it("falls back to the default when the persisted height is invalid", () => {
    localStorage.setItem(HEIGHT_KEY, "not-a-number");
    const { container } = renderView();
    expect(getPanel(container).style.height).toBe("288px");

    localStorage.setItem(HEIGHT_KEY, "50"); // below the 160px minimum
    const { container: c2 } = renderView();
    expect(getPanel(c2).style.height).toBe("288px");
  });
});

describe("ChangesView diff presentation", () => {
  const diff = {
    path: "src/example.ts",
    old_path: null,
    additions: 1,
    deletions: 0,
    hunks: [{
      header: "@@ -1,0 +1,1 @@",
      lines: [{ content: "value", line_type: "add", old_line_no: null, new_line_no: 1 }],
    }],
  };

  it("renders staged and workdir diffs as separate interactive sections", () => {
    mockRepoState.selectedFile = diff.path;
    mockRepoState.stagedDiff = [diff];
    mockRepoState.workdirDiff = [diff];
    const { getByLabelText } = renderView();

    expect(getByLabelText("已暂存的改动")).toBeInTheDocument();
    expect(getByLabelText("工作区改动")).toBeInTheDocument();
    expect(getByLabelText("取消暂存此代码块")).toBeInTheDocument();
    expect(getByLabelText("暂存此代码块")).toBeInTheDocument();
  });

  it("uses a full-width diff with a back action when inline display is disabled", () => {
    mockSettingsState.config.ui.show_diff_inline = false;
    mockRepoState.selectedFile = diff.path;
    mockRepoState.workdirDiff = [diff];
    const { getByLabelText, container } = renderView();

    expect(getByLabelText("返回改动列表")).toBeInTheDocument();
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});
