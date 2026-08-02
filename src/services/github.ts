import { invoke } from "@tauri-apps/api/core";
import type {
  CreatePullRequest,
  GhStatus,
  GitHubRemote,
  InlineCommentRequest,
  PullRequest,
  PullRequestDetail,
  PullRequestWorkflowResult,
} from "@/types";
import { isTauriEnv } from "@/utils/env";

function ensureTauri() {
  if (!isTauriEnv()) throw new Error("GitHub workflow is available in the desktop app only.");
}

export const githubService = {
  remote(path: string, remote?: string) {
    ensureTauri();
    return invoke<GitHubRemote>("github_remote", { path, remote });
  },
  ghStatus(path: string, remote?: string) {
    ensureTauri();
    return invoke<GhStatus>("github_gh_status", { path, remote });
  },
  openCompare(path: string, base: string, head: string, remote?: string) {
    ensureTauri();
    return invoke<string>("github_open_compare", { path, remote, base, head });
  },
  list(path: string, remote?: string) {
    ensureTauri();
    return invoke<PullRequest[]>("github_pr_list", { path, remote });
  },
  view(path: string, number: number, remote?: string) {
    ensureTauri();
    return invoke<PullRequestDetail>("github_pr_view", { path, remote, number });
  },
  create(path: string, input: CreatePullRequest, remote?: string) {
    ensureTauri();
    return invoke<PullRequestWorkflowResult>("github_pr_create", { path, remote, input });
  },
  checkout(path: string, number: number, remote?: string) {
    ensureTauri();
    return invoke<string>("github_pr_checkout", { path, remote, number });
  },
  publishInlineComment(path: string, input: InlineCommentRequest, remote?: string) {
    ensureTauri();
    return invoke<string>("github_publish_inline_comment", { path, remote, input });
  },
  setPat(token: string) {
    ensureTauri();
    return invoke<void>("set_github_pat", { token });
  },
  deletePat() {
    ensureTauri();
    return invoke<void>("delete_github_pat");
  },
};
