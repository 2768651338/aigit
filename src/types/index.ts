// Types mirroring Rust structs for type-safe IPC

/** Structured error returned by Tauri commands. */
export interface ErrorDto {
  code: string;
  message: string;
  retryable: boolean;
  diagnostic_id?: string | null;
}

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
  line_type: string; // "add" | "delete" | "context" | "no_newline"
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

export interface CommitSnapshot {
  repo_path: string;
  head: string;
  index_tree: string;
  diff_hash: string;
}

export type PatchSelectionKind = "hunk" | "whole_file_fallback";

export interface PatchSelection {
  id: string;
  file_path: string;
  old_path: string | null;
  hunk_header: string;
  patch: string;
  kind: PatchSelectionKind;
  fallback_reason: string | null;
  snapshot: CommitSnapshot;
}

export interface CommitGroup {
  id: string;
  reason: string;
  message: string;
  selections: PatchSelection[];
  committed_hash: string | null;
}

export interface CommitPlan {
  id: string;
  schema_version: number;
  snapshot: CommitSnapshot;
  groups: CommitGroup[];
  existing_staged: boolean;
  fallback: boolean;
  warning: string | null;
}

export interface StageGroupResult {
  group_id: string;
  staged_tree: string;
  state: "awaiting_commit_confirmation";
  recovery: string;
}

export interface CommitGroupResult {
  group_id: string;
  commit_hash: string;
  state: "paused_after_commit";
  recovery: string;
  plan: CommitPlan;
}

export interface RemoteInfo {
  name: string;
  fetch_url: string;
  push_url: string;
}

export interface GitHubRemote {
  remote_name: string;
  host: string;
  owner: string;
  repo: string;
  web_base_url: string;
  api_base_url: string;
  is_enterprise: boolean;
}

export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  error: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  url: string;
  author: string;
  head: string;
  base: string;
  created_at: string;
  updated_at: string;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

export interface PullRequestDetail {
  pull_request: PullRequest;
  checks: CheckRun[];
}

export interface CreatePullRequest {
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
}

export interface InlineCommentRequest {
  pull_number: number;
  report_id: string;
  finding_id: string;
  confirmed: boolean;
}

export interface PullRequestWorkflowResult {
  pull_request: PullRequest | null;
  opened_url: string | null;
  backend: "gh" | "api" | "browser";
}


export interface TrackingInfo {
  branch: string;
  upstream: string | null;
  remote: string | null;
  remote_branch: string | null;
  ahead: number;
  behind: number;
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

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "resolved" | "false_positive";

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  category: string;
  file: string;
  line: number | null;
  title: string;
  description: string;
  suggestion: string;
  confidence: number;
  metadata: Record<string, unknown>;
  status: FindingStatus;
}

export interface ReviewReport {
  id: string;
  schema_version: number;
  summary: string;
  findings: ReviewFinding[];
  raw_markdown: string | null;
  fallback: boolean;
  generated_at: string;
  head_hash: string | null;
  diff_hash: string;
  staged_only: boolean;
  file_path: string | null;
  stale: boolean;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: number;
  attachments?: ChatAttachmentMetadata[];
}

export type ChatAttachment =
  | { kind: "file"; path: string; ref_name?: string | null; confirmed?: boolean }
  | { kind: "commit"; hash: string; confirmed?: boolean };

export interface ChatAttachmentMetadata {
  kind: "file" | "commit";
  label: string;
  path?: string | null;
  hash?: string | null;
  estimated_tokens: number;
  size_bytes: number;
  sensitive: boolean;
}

export interface ChatSession {
  id: string;
  repo_path: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: Array<{
    id: string;
    role: ChatMessage["role"];
    content: string;
    created_at: number;
    attachments: ChatAttachmentMetadata[];
  }>;
}

export type PersistedChatSession = ChatSession;

export interface ChatLoadResult {
  sessions: PersistedChatSession[];
  recovered_corrupt_data: boolean;
}

export interface ChatAttachmentInspection extends ChatAttachmentMetadata {
  requires_confirmation: boolean;
}

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

export type GitOperationKind = "merge" | "rebase" | "cherry_pick" | "revert" | "stash";

export interface GitOperationState {
  kind: GitOperationKind | null;
  in_progress: boolean;
  conflicts: string[];
}

export type ConflictKind =
  | "both_modified"
  | "both_added"
  | "both_deleted"
  | "deleted_by_ours"
  | "deleted_by_theirs"
  | "rename_delete"
  | "binary"
  | "submodule"
  | "other";

export interface ConflictStage {
  path: string;
  oid: string;
  mode: number;
  content: string | null;
}

export interface ConflictFile {
  path: string;
  kind: ConflictKind;
  base: ConflictStage | null;
  ours: ConflictStage | null;
  theirs: ConflictStage | null;
  worktree_content: string | null;
  can_edit_text: boolean;
  fallback_reason: "binary" | "submodule" | "rename_delete" | null;
}

export interface CredentialStatus {
  openai: boolean;
  claude: boolean;
  deepseek: boolean;
  embedding_openai: boolean;
}

export type CredentialProvider = keyof CredentialStatus;

export interface AiProviderConfig {
  active_provider: string;
  openai_model: string;
  openai_base_url: string;
  claude_model: string;
  claude_base_url: string;
  deepseek_model: string;
  deepseek_base_url: string;
  ollama_base_url: string;
  ollama_model: string;
  temperature: number;
  max_tokens: number;
  /** Model context window in tokens; oversized inputs are truncated to this. */
  max_context_tokens: number;
  credential_status: CredentialStatus;
}

export interface IndexConfig {
  enabled: boolean;
  never_upload_index: boolean;
  embedding_provider: "ollama" | "openai_compatible";
  ollama_embedding_base_url: string;
  ollama_embedding_model: string;
  cloud_embedding_enabled: boolean;
  cloud_embedding_base_url: string;
  cloud_embedding_model: string;
  extra_excludes: string[];
  include_untracked: boolean;
  max_file_bytes: number;
  max_chunks: number;
  chunk_lines: number;
  chunk_overlap: number;
  max_embedding_chars: number;
  top_k: number;
  max_context_tokens: number;
}

export type IndexPhase = "idle" | "scanning" | "embedding" | "ready" | "cancelled" | "failed";
export interface IndexStatus {
  phase: IndexPhase;
  files_total: number;
  files_processed: number;
  chunks: number;
  reused_chunks: number;
  stale: boolean;
  message: string | null;
  updated_at: number;
}
export interface CodeSearchHit {
  path: string;
  start_line: number;
  end_line: number;
  language: string;
  symbols: string[];
  score: number;
  text: string;
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
  index: IndexConfig;
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
  /** Remote configuration and tracking are cached per repository tab. */
  remotes: RemoteInfo[];
  tracking: TrackingInfo | null;
  /** Timestamp of the last successful fetch (never changed by ordinary loads). */
  fetchUpdatedAt: number | null;
  /** Per-repository remote operation state. */
  remoteBusy: string | null;
  remoteError: string | null;
  remoteTask: { key: "fetch" | "pull" | "push"; id: string } | null;
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
  /** Active sequencer/conflict operation, including stash conflicts. */
  operationKind: GitOperationKind | null;
  /** `true` when a conflict-producing Git operation is in progress. */
  mergeInProgress: boolean;
  /** Compatibility projection for existing rebase-specific controls. */
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
  /** Total branches; retained for compatibility with older backend responses. */
  branch_count: number;
  local_branch_count?: number;
  remote_branch_count?: number;
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
