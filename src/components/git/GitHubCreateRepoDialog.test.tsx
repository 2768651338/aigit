import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubCreateProvider, GitHubCreateRepoDialog } from "./GitHubCreateRepoDialog";

const services = vi.hoisted(() => ({
  ghStatusForHost: vi.fn(),
  createRepo: vi.fn(),
}));

const translate = vi.hoisted(() => (key: string) => key);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

const store = vi.hoisted(() => ({
  currentPath: "C:/repo/my-app",
  loadRemoteState: vi.fn(() => Promise.resolve()),
  refreshBranches: vi.fn(() => Promise.resolve()),
  refreshRepoInfo: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-i18next", () => ({
  // `initReactI18next` must exist because modules in this graph (error.ts)
  // initialize the real i18n singleton.
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/services/github", () => ({ githubService: services }));
vi.mock("@/stores/toastStore", () => ({ useToastStore: () => toast }));
vi.mock("@/utils/modalA11y", () => ({ useModalAccessibility: vi.fn() }));
vi.mock("@/stores/repoStore", () => ({
  useRepoStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const ghReady = { installed: true, authenticated: true, version: "2.x", error: null };

function renderDialog() {
  return render(
    <GitHubCreateProvider>
      <GitHubCreateRepoDialog onClose={vi.fn()} />
    </GitHubCreateProvider>,
  );
}

describe("GitHubCreateRepoDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.ghStatusForHost.mockResolvedValue(ghReady);
    services.createRepo.mockResolvedValue({
      url: "https://github.com/me/my-app",
      remote_name: "origin",
      pushed: true,
    });
  });

  it("publishes with the derived repo name and reports success", async () => {
    renderDialog();
    const nameInput = await screen.findByPlaceholderText("githubCreate.namePlaceholder");
    await waitFor(() => expect(nameInput).not.toBeDisabled());
    expect(nameInput).toHaveValue("my-app");
    expect(services.ghStatusForHost).toHaveBeenCalledWith("github.com");
    fireEvent.click(screen.getByText("githubCreate.create"));

    await waitFor(() =>
      expect(services.createRepo).toHaveBeenCalledWith("C:/repo/my-app", {
        name: "my-app",
        description: null,
        private: true,
        host: "github.com",
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "githubCreate.success",
      ),
    );
  });

  it("probes and publishes against a custom GitHub Enterprise host", async () => {
    renderDialog();
    const hostInput = await screen.findByPlaceholderText("githubCreate.hostPlaceholder");
    await waitFor(() => expect(hostInput).not.toBeDisabled());
    fireEvent.change(hostInput, { target: { value: "GitHub.Example.com/" } });
    fireEvent.blur(hostInput);

    await waitFor(() => expect(services.ghStatusForHost).toHaveBeenCalledWith("github.example.com"));
    const nameInput = screen.getByPlaceholderText("githubCreate.namePlaceholder");
    await waitFor(() => expect(nameInput).not.toBeDisabled());
    fireEvent.click(screen.getByText("githubCreate.create"));

    await waitFor(() =>
      expect(services.createRepo).toHaveBeenCalledWith("C:/repo/my-app", {
        name: "my-app",
        description: null,
        private: true,
        host: "github.example.com",
      }),
    );
  });

  it("blocks the form when the GitHub CLI is missing or unauthenticated", async () => {
    services.ghStatusForHost.mockResolvedValue({ installed: false, authenticated: false, version: null, error: null });
    renderDialog();
    expect(await screen.findByText("githubCreate.ghMissing")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("githubCreate.namePlaceholder")).toBeDisabled();
    expect(screen.getByText("githubCreate.create")).toBeDisabled();

    services.ghStatusForHost.mockResolvedValue({ installed: true, authenticated: false, version: "2.x", error: null });
    fireEvent.click(screen.getByText("githubCreate.retry"));
    expect(await screen.findByText("githubCreate.ghUnauthed")).toBeInTheDocument();
  });

  it("rejects invalid slugs and keeps the create button disabled", async () => {
    renderDialog();
    const nameInput = await screen.findByPlaceholderText("githubCreate.namePlaceholder");
    await waitFor(() => expect(nameInput).not.toBeDisabled());
    fireEvent.change(nameInput, { target: { value: "bad name!" } });
    expect(screen.getByText("githubCreate.nameInvalid")).toBeInTheDocument();
    expect(screen.getByText("githubCreate.create")).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "owner/team-repo" } });
    expect(screen.queryByText("githubCreate.nameInvalid")).not.toBeInTheDocument();
    expect(screen.getByText("githubCreate.create")).not.toBeDisabled();
  });

  it("rejects invalid hosts and keeps the create button disabled", async () => {
    renderDialog();
    const hostInput = await screen.findByPlaceholderText("githubCreate.hostPlaceholder");
    await waitFor(() => expect(hostInput).not.toBeDisabled());
    fireEvent.change(hostInput, { target: { value: "ghe.local/api" } });
    expect(screen.getByText("githubCreate.hostInvalid")).toBeInTheDocument();
    expect(screen.getByText("githubCreate.create")).toBeDisabled();

    fireEvent.change(hostInput, { target: { value: "ghe.local:8443" } });
    expect(screen.queryByText("githubCreate.hostInvalid")).not.toBeInTheDocument();
    expect(screen.getByText("githubCreate.create")).not.toBeDisabled();
  });
});
