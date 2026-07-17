pub mod branch;
pub mod commit;
pub mod diff;
pub mod remote;
pub mod repo;
pub mod status;

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
