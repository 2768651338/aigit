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

/**
 * A user-attached context reference in a chat message.
 *
 * The frontend parses `@file:<path>` and `@commit:<hash>` mentions out of
 * the user's input and passes them as an `attachments` array on the chat
 * request. The backend resolves them to actual content blocks (file at a
 * ref, commit patch) and injects them into the system prompt.
 *
 * Tagged union — `kind` discriminates between the two variants. The Rust
 * side uses `#[serde(tag = "kind", rename_all = "snake_case")]` so the
 * JSON wire format is `{ kind: "file", path, ref_name? }` /
 * `{ kind: "commit", hash }`.
 */
export type ChatAttachment =
  | { kind: "file"; path: string; ref_name?: string | null }
  | { kind: "commit"; hash: string };

/** Stash entry snapshot (mirrors `git::StashInfo`). */
export interface StashInfo {
  /** Stash index in the reflog (0 = most recent). */
  index: number;
  hash: string;
  short_hash: string;
  message: string;
  /** Unix seconds. */
  date: number;
}

/** Tag descriptor (mirrors `git::TagInfo`). */
export interface TagInfo {
  name: string;
  target_hash: string;
  short_hash: string;
  target_message: string;
  /** Unix seconds. */
  target_date: number;
  is_annotated: boolean;
  annotation: string;
  tagger: string | null;
}

/** Submodule descriptor (mirrors `git::SubmoduleInfo`). */
export interface SubmoduleInfo {
  name: string;
  path: string;
  head_oid: string;
  short_hash: string;
  url: string;
  /** "unchanged" | "modified" | "uninitialized" | "deleted" | "unknown". */
  status: string;
}

/** Result of a merge or rebase operation (mirrors `git::MergeResult`). */
export interface MergeResult {
  success: boolean;
  message: string;
  has_conflicts: boolean;
  conflicts: string[];
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
  /** Stash entries (null = not yet loaded). */
  stashes: StashInfo[] | null;
  /** Tags (null = not yet loaded). */
  tags: TagInfo[] | null;
  /** Submodules (null = not yet loaded). */
  submodules: SubmoduleInfo[] | null;
  /** `true` when a merge/rebase is in progress (MERGE_HEAD or rebase-apply/merge exists). */
  mergeInProgress: boolean;
  /** `true` for rebase in progress, `false` for merge in progress (only meaningful when `mergeInProgress`). */
  isRebasing: boolean;
  /** Conflicted file paths surfaced by the last merge/rebase (empty when none). */
  conflicts: string[];
  /** True while a merge/rebase operation is in flight. */
  merging: boolean;
}

/** Compact repository-wide statistics returned by the insights command. */
export interface RepositoryInsights {
  repository_name: string;
  start_date: string | null;
  end_date: string | null;
  total_commits: number;
  contributor_count: number;
  branch_count: number;
  tag_count: number;
  daily_contributions: DailyContribution[];
  contributors: ContributorInsights[];
  timeline: TimelineBucket[];
  milestones: InsightMilestone[];
  recent_commits: InsightCommitSummary[];
}

export interface DailyContribution { date: string; count: number; }
export interface ContributorInsights {
  name: string;
  email: string;
  commit_count: number;
  active_days: number;
  first_date: string;
  last_date: string;
  activity: number[];
}
export interface TimelineBucket {
  period: string;
  cumulative_commits: number;
  cumulative_contributors: number;
  commits: number;
  contributors: number;
}
export interface InsightMilestone { name: string; hash: string; date: string; message: string; }
export interface InsightCommitSummary { hash: string; author: string; date: string; message: string; }
export interface AuthorAliasRule { email: string; display_name: string; }
export interface InsightExportOptions {
  format: "svg" | "png" | "gif" | "markdown" | "text";
  fileName?: string;
  width?: number;
  height?: number;
  scale?: number;
  frameRate?: number;
}

export type ViewType = "changes" | "branches" | "review" | "chat" | "insights" | "settings";

export type FileStatusType =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "typechange";
