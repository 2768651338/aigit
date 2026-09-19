import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseNotesGenerator } from "./ReleaseNotesGenerator";
import type { AppConfig, LogEntry } from "@/types";

const git = vi.hoisted(() => ({
  listTags: vi.fn(),
  getLogRange: vi.fn(),
}));

const github = vi.hoisted(() => ({
  ghStatus: vi.fn(),
  releaseCreate: vi.fn(),
}));

const ai = vi.hoisted(() => ({
  repoChat: vi.fn(),
}));

const translate = vi.hoisted(() => (key: string) => key);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: translate, i18n: { language: "en" } }),
}));
vi.mock("@/services/git", () => ({ gitService: git }));
vi.mock("@/services/github", () => ({ githubService: github }));
vi.mock("@/services/ai", () => ({ aiService: ai }));
vi.mock("@/stores/toastStore", () => ({ useToastStore: () => toast }));
vi.mock("@/utils/dialog", () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)) }));

const tags = [
  { name: "v1.0.0", target_hash: "a1", short_hash: "a1", target_message: "r1", target_date: 1000, is_annotated: false, annotation: "", tagger: null },
  { name: "v1.1.0", target_hash: "a2", short_hash: "a2", target_message: "r2", target_date: 2000, is_annotated: true, annotation: "", tagger: null },
];

const entries: LogEntry[] = [
  { hash: "h2", short_hash: "h2", author: "A", email: "a@example.com", message: "feat(ui): 拖拽排序", body: "", timestamp: 3000, parents: [], refs: [] },
  { hash: "h3", short_hash: "h3", author: "B", email: "b@example.com", message: "fix: 崩溃", body: "", timestamp: 3100, parents: [], refs: [] },
];

const config = { ai: {} } as unknown as AppConfig;

describe("ReleaseNotesGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    git.listTags.mockResolvedValue(tags);
    git.getLogRange.mockResolvedValue(entries);
    github.ghStatus.mockResolvedValue({ installed: true, authenticated: true, version: "x", error: null });
    github.releaseCreate.mockResolvedValue("https://github.com/o/r/releases/1");
    ai.repoChat.mockResolvedValue("polished notes");
  });

  it("loads tags, defaults the range start to the newest tag and renders the grouped draft", async () => {
    render(<ReleaseNotesGenerator config={config} repoPath="C:/repo" />);

    await waitFor(() =>
      expect(git.getLogRange).toHaveBeenCalledWith("C:/repo", "v1.1.0", undefined, 1000),
    );
    expect(await screen.findByText("insights.releaseNotes.commitsCount")).toBeInTheDocument();
    expect(screen.getByText("h2 feat(ui): 拖拽排序")).toBeInTheDocument();
    const draft = screen.getByLabelText("insights.releaseNotes.draftTitle") as HTMLTextAreaElement;
    await waitFor(() => expect(draft.value).toContain("insights.releaseNotes.features"));
    expect(draft.value).toContain("**ui**: 拖拽排序");
    expect(draft.value).toContain("- 崩溃");
  });

  it("keeps the draft-release button disabled while the end is HEAD", async () => {
    render(<ReleaseNotesGenerator config={config} repoPath="C:/repo" />);
    await waitFor(() => expect(git.getLogRange).toHaveBeenCalled());

    expect(screen.getByText("insights.releaseNotes.releaseBtn")).toBeDisabled();
    expect(github.releaseCreate).not.toHaveBeenCalled();
  });

  it("drafts a GitHub release for the selected end tag after confirmation", async () => {
    render(<ReleaseNotesGenerator config={config} repoPath="C:/repo" />);
    await waitFor(() => expect(git.getLogRange).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("insights.releaseNotes.headLabel"), {
      target: { value: "v1.0.0" },
    });
    await waitFor(() =>
      expect(git.getLogRange).toHaveBeenLastCalledWith("C:/repo", "v1.1.0", "v1.0.0", 1000),
    );
    fireEvent.click(screen.getByText("insights.releaseNotes.releaseBtn"));

    await waitFor(() =>
      expect(github.releaseCreate).toHaveBeenCalledWith("C:/repo", "v1.0.0", "v1.0.0", expect.stringContaining("insights.releaseNotes.features")),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("sends the polish request over repo chat with an untrusted payload", async () => {
    render(<ReleaseNotesGenerator config={config} repoPath="C:/repo" />);
    await waitFor(() => expect(git.getLogRange).toHaveBeenCalled());
    fireEvent.click(screen.getByText("insights.releaseNotes.polish"));

    await waitFor(() => expect(ai.repoChat).toHaveBeenCalledTimes(1));
    const [messages, repoPath] = ai.repoChat.mock.calls[0];
    expect(repoPath).toBe("C:/repo");
    const content = messages[0].content as string;
    expect(content).toContain("insights.releaseNotes.aiPrompt");
    expect(content).toContain("<untrusted>");
    expect(await screen.findByText("polished notes")).toBeInTheDocument();
  });
});
