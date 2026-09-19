pub mod bisect;
pub mod branch;
pub(crate) mod cli;
pub mod commit;
pub mod conflict;
pub mod diff;
pub mod health;
pub mod history;
pub mod hooks;
pub mod ignore;
pub mod insights;
pub mod merge;
pub mod remote;
pub mod repo;
pub mod smart_commit;
pub mod stash;
pub mod status;
pub mod submodule;
pub mod tag;
pub mod tree;
pub mod worktree;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStatus {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub content: String,
    pub line_type: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingInfo {
    pub branch: String,
    pub upstream: Option<String>,
    pub remote: Option<String>,
    pub remote_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub last_commit_hash: String,
    pub last_commit_message: String,
    pub last_commit_date: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    /// 提交主题（首行），供列表等紧凑场景展示。
    pub message: String,
    /// 提交正文（首行之后的其余内容），可能为空；供详情面板完整展示。
    pub body: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub current_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub head_hash: Option<String>,
}

/// Snapshot of a single stash entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashInfo {
    /// Stash index in the reflog (0 = most recent).
    pub index: usize,
    /// Stash commit hash.
    pub hash: String,
    /// Short hash (first 7 chars).
    pub short_hash: String,
    /// Stash message as supplied to `git stash save`.
    pub message: String,
    /// Stash commit timestamp (Unix seconds).
    pub date: i64,
}

/// Lightweight or annotated tag descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub name: String,
    /// Target commit hash.
    pub target_hash: String,
    pub short_hash: String,
    /// Target commit summary.
    pub target_message: String,
    /// Target commit timestamp (Unix seconds).
    pub target_date: i64,
    /// `true` for annotated tags, `false` for lightweight.
    pub is_annotated: bool,
    /// Annotated tag message (empty for lightweight).
    pub annotation: String,
    /// Tagger name (annotated only).
    pub tagger: Option<String>,
}

/// Submodule descriptor returned by `list_submodules`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmoduleInfo {
    /// Logical name (typically the submodule's path in `.gitmodules`).
    pub name: String,
    /// Path inside the superproject working tree.
    pub path: String,
    /// HEAD commit OID recorded in the submodule's repository.
    pub head_oid: String,
    /// Short hash.
    pub short_hash: String,
    /// URL from `.gitmodules` (empty if not initialized).
    pub url: String,
    /// Status string: "unchanged" / "modified" / "uninitialized" / "deleted".
    pub status: String,
}

/// One lazily listed entry of the repository tree browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeEntry {
    /// File or directory name (last path component).
    pub name: String,
    /// Path relative to the repo root, `/`-separated, no trailing slash.
    pub path: String,
    /// `"dir"` or `"file"`.
    pub kind: String,
    /// `true` when this listing hit the per-directory entry cap.
    pub truncated: bool,
}

/// Text content of a worktree file for the file browser preview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    /// UTF-8 (lossy) file content; empty for binary files.
    pub content: String,
    /// `true` when the file contains NUL bytes (binary).
    pub is_binary: bool,
    /// `true` when the file exceeded the read cap and was cut short.
    pub truncated: bool,
    pub size_bytes: u64,
}

/// Per-line blame attribution for a file at HEAD.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlameLine {
    /// 1-based line number in the current file.
    pub line: u32,
    pub commit_hash: String,
    pub short_hash: String,
    pub author: String,
    pub timestamp: i64,
    /// Commit subject.
    pub summary: String,
}

/// One HEAD reflog entry, used by the recovery panel to find commits that
/// were reset away or lost in a rebase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflogEntry {
    /// Commit the ref pointed to before the move.
    pub old_hash: String,
    /// Commit the ref points to after the move.
    pub new_hash: String,
    /// Short hash (first 7 chars) of `new_hash`.
    pub short_hash: String,
    /// Who performed the move.
    pub author: String,
    pub timestamp: i64,
    /// Reflog action message (e.g. "reset: moving to <hash>").
    pub message: String,
}

/// Result of a merge or rebase operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    /// `true` if the operation completed without conflicts.
    pub success: bool,
    /// Human-readable summary from git.
    pub message: String,
    /// `true` if conflicts remain and the operation is paused.
    pub has_conflicts: bool,
    /// List of conflicting file paths (empty when no conflicts).
    pub conflicts: Vec<String>,
}
