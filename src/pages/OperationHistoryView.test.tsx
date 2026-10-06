import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperationHistoryView } from "@/pages/OperationHistoryView";

const services = vi.hoisted(() => ({
  listOperationHistory: vi.fn(),
  clearOperationHistory: vi.fn(),
  undoOperation: vi.fn(),
}));

vi.mock("@/services/git", () => ({ gitService: services }));
vi.mock("@/stores/repoStore", () => ({
  useRepoStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ currentPath: "D:/repos/demo", refreshStatus: vi.fn() }),
    { getState: () => ({ currentPath: "D:/repos/demo" }) },
  ),
}));
vi.mock("@/stores/toastStore", () => {
  const toastMocks = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  return {
    useToastStore: () => toastMocks,
    __toastMocks: toastMocks,
  };
});
vi.mock("@/utils/dialog", () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const record = (overrides: Record<string, unknown>) => ({
  id: "id",
  timestamp: Math.floor(Date.now() / 1000) - 60,
  kind: "reset",
  summary: "",
  branch_before: "main",
  head_before: null,
  reversible: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  services.listOperationHistory.mockResolvedValue([]);
});

describe("OperationHistoryView", () => {
  it("renders records with localized kind badge and per-record undo availability", async () => {
    services.listOperationHistory.mockResolvedValue([
      record({ id: "r1", kind: "reset", summary: "reset --hard abc1234", reversible: true }),
      record({ id: "r2", kind: "discard", summary: "discard 2 file(s)", reversible: false }),
    ]);

    render(<OperationHistoryView />);

    expect(await screen.findByText("reset --hard abc1234")).toBeInTheDocument();
    expect(screen.getByText("oplog.kind.reset")).toBeInTheDocument();
    expect(screen.getByText("oplog.kind.discard")).toBeInTheDocument();
    // 可撤销行有撤销按钮；不可撤销行只有文字。
    expect(screen.getByRole("button", { name: "oplog.undo" })).toBeInTheDocument();
    expect(screen.getByText("oplog.notReversible")).toBeInTheDocument();
  });

  it("undo asks for confirmation, passes stashDirty=true and reloads the list", async () => {
    services.listOperationHistory
      .mockResolvedValueOnce([record({ id: "r1", kind: "reset", summary: "reset --hard abc1234" })])
      .mockResolvedValueOnce([record({ id: "r1", kind: "reset", summary: "reset --hard abc1234" })]);
    services.undoOperation.mockResolvedValue({
      backup_branch: "aigit/undo-backup-123",
      stashed: true,
      switched_to: null,
    });
    const { confirmDialog } = await import("@/utils/dialog");

    render(<OperationHistoryView />);
    const button = await screen.findByRole("button", { name: "oplog.undo" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(services.undoOperation).toHaveBeenCalledWith("D:/repos/demo", "r1", true);
    });
    expect(confirmDialog).toHaveBeenCalled();
    // 撤销成功后重新加载操作历史。
    await waitFor(() => {
      expect(services.listOperationHistory).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces undo failures from the backend guard instead of failing silently", async () => {
    services.listOperationHistory.mockResolvedValue([
      record({ id: "r1", kind: "reset", summary: "reset --hard abc1234" }),
    ]);
    services.undoOperation.mockRejectedValue({
      code: "uncommitted_changes",
      message: "存在未提交的修改。",
      retryable: false,
    });

    render(<OperationHistoryView />);
    const button = await screen.findByRole("button", { name: "oplog.undo" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(services.undoOperation).toHaveBeenCalled();
    });
    // 列表不会刷新为空（第一次加载之后不再重复调用）。
    expect(services.listOperationHistory).toHaveBeenCalledTimes(1);
  });

  it("clear requires confirmation and reloads", async () => {
    services.listOperationHistory.mockResolvedValue([
      record({ id: "r1", kind: "merge", summary: "merge feature", reversible: true }),
    ]);
    services.clearOperationHistory.mockResolvedValue(undefined);

    render(<OperationHistoryView />);
    const button = await screen.findByRole("button", { name: /oplog.clear/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(services.clearOperationHistory).toHaveBeenCalledWith("D:/repos/demo");
    });
    await waitFor(() => {
      expect(services.listOperationHistory).toHaveBeenCalledTimes(2);
    });
  });
});
