// Types mirroring Rust structs for type-safe IPC

export interface RepoInfo {
  path: string;
  name: string;
  current_branch: string | null;
  ahead: number;
  behind: number;
  head_hash: string | null;
}

export interface FileStatus {
  path: string;
  old_path: string | null;
  status: string;
  staged: boolean;
}

export interface DiffLine {
  content: string;
  line_type: string; // "add" | "delete" | "context"
  old_line_no: number | null;
  new_line_no: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  old_path: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
  last_commit_hash: string;
  last_commit_message: string;
  last_commit_date: number;
}

export interface LogEntry {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  message: string;
  timestamp: number;
  parents: string[];
  refs: string[];
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiProviderConfig {
  active_provider: string;
  openai_api_key: string;
  openai_model: string;
  openai_base_url: string;
  claude_api_key: string;
  claude_model: string;
  claude_base_url: string;
  deepseek_api_key: string;
  deepseek_model: string;
  deepseek_base_url: string;
  ollama_base_url: string;
  ollama_model: string;
  temperature: number;
  max_tokens: number;
}

export interface UiConfig {
  theme: string;
  font_size: number;
  show_diff_inline: boolean;
  language: string;
}

/**
 * User-customizable AI system prompts.
 * Empty string means "use the built-in default".
 */
export interface PromptsConfig {
  commit_message: string;
  code_review: string;
  repo_chat: string;
}

/** Built-in default prompts returned by `get_default_prompts` command. */
export interface DefaultPrompts {
  commit_message: string;
  code_review: string;
  repo_chat: string;
}

export interface AppConfig {
  ai: AiProviderConfig;
  ui: UiConfig;
  prompts: PromptsConfig;
  recent_repos: string[];
  /** Paths of repos currently open as tabs. */
  open_repos: string[];
  /** Path of the currently active tab. `null` when no tab is open. */
  active_repo: string | null;
}

/**
 * State snapshot for a single open repository tab.
 * `repoStore` keeps a `Map<path, RepoTabState>` so each tab has its own
 * working set (file statuses, diffs, branches, commit draft, etc.) and
 * switching tabs does not lose in-progress state.
 */
export interface RepoTabState {
  /** Absolute path of the repository working directory. */
  path: string;
  repoInfo: RepoInfo | null;
  fileStatuses: FileStatus[];
  selectedFile: string | null;
  workdirDiff: FileDiff[];
  stagedDiff: FileDiff[];
  branches: BranchInfo[];
  log: LogEntry[];
  loading: boolean;
  error: string | null;
  pushing: boolean;
  pulling: boolean;
  /** Commit message draft — preserved when switching tabs. */
  commitMessage: string;
  /** Transient commit/push operation flags. */
  committing: boolean;
  commitAndPushing: boolean;
  /** True while a refresh (status/branches/log) is in-flight — guards against concurrent refreshes. */
  refreshing: boolean;
  /** Error surfaced by the last push/pull operation (cleared on retry). */
  pushError: string | null;
  /** Error surfaced by the last AI generate operation. */
  aiError: string | null;
  aiLoading: boolean;
}

export type ViewType = "changes" | "branches" | "review" | "chat" | "settings";

export type FileStatusType =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "typechange";
