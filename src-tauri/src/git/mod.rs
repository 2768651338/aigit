pub mod branch;
pub(crate) mod cli;
pub mod commit;
pub mod conflict;
pub mod diff;
pub mod history;
pub mod insights;
pub mod merge;
pub mod remote;
pub mod repo;
pub mod smart_commit;
pub mod stash;
pub mod status;
pub mod submodule;
pub mod tag;

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
    pub message: String,
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
