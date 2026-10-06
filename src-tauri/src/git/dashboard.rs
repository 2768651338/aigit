//! 多仓库仪表盘：为"打开的仓库 + 最近仓库"聚合一个轻量状态快照。
//!
//! 每个仓库独立容错：单个仓库打不开（被移动/删除/损坏）不影响其它仓库，
//! 只把错误放进该条目的 `error` 字段由前端展示。

use git2::Repository;
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct RepoDashboardItem {
    pub path: String,
    pub valid: bool,
    pub name: String,
    pub current_branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged_files: usize,
    pub unstaged_files: usize,
    pub untracked_files: usize,
    pub head_summary: Option<String>,
    /// Unix 秒。
    pub last_commit_ts: Option<i64>,
    /// 空仓库（零提交）：仍显示分支名，ahead/behind 恒为 0。
    pub unborn: bool,
    pub error: Option<String>,
}

/// 聚合单个仓库的仪表盘数据；绝不向上抛错，坏仓库返回 invalid 条目。
pub fn collect_dashboard(repo_path: &str) -> RepoDashboardItem {
    match build_item(repo_path) {
        Ok(item) => item,
        Err(error) => invalid_item(repo_path, error.to_string()),
    }
}

/// 无效仓库的占位条目（含后台任务 join 失败等极端情况的兜底）。
pub fn invalid_item(repo_path: &str, error: String) -> RepoDashboardItem {
    let path = std::path::Path::new(repo_path);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());
    RepoDashboardItem {
        path: repo_path.to_string(),
        valid: false,
        name,
        current_branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        staged_files: 0,
        unstaged_files: 0,
        untracked_files: 0,
        head_summary: None,
        last_commit_ts: None,
        unborn: false,
        error: Some(error),
    }
}

fn build_item(repo_path: &str) -> AppResult<RepoDashboardItem> {
    let repo = super::repo::open_repo(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let name = workdir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());

    let mut item = RepoDashboardItem {
        path: repo_path.to_string(),
        valid: true,
        name,
        current_branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        staged_files: 0,
        unstaged_files: 0,
        untracked_files: 0,
        head_summary: None,
        last_commit_ts: None,
        unborn: super::repo::head_is_unborn(&repo),
        error: None,
    };

    if item.unborn {
        item.current_branch = unborn_branch_name(&repo);
        return Ok(item);
    }

    let head = repo.head()?;
    item.current_branch = if head.is_branch() {
        head.shorthand()
            .map(str::to_string)
            .filter(|branch| !branch.is_empty())
    } else {
        None
    };

    if let Some(branch_name) = item.current_branch.clone() {
        if let Ok(branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
            if let Ok(upstream) = branch.upstream() {
                item.upstream = upstream.name()?.map(str::to_string);
                if let (Ok(local), Ok(remote)) = (
                    branch.get().peel_to_commit(),
                    upstream.get().peel_to_commit(),
                ) {
                    let (ahead, behind) = repo.graph_ahead_behind(local.id(), remote.id())?;
                    item.ahead = ahead;
                    item.behind = behind;
                }
            }
        }
    }

    // 复用全局状态口径：一个文件可能同时出现在暂存与工作区两组里。
    for entry in super::status::get_status(&repo)? {
        if entry.staged {
            item.staged_files += 1;
        } else if entry.status == "untracked" {
            item.untracked_files += 1;
        } else {
            item.unstaged_files += 1;
        }
    }

    if let Ok(commit) = head.peel_to_commit() {
        item.head_summary = commit.summary().map(str::to_string);
        item.last_commit_ts = Some(commit.time().seconds());
    }

    Ok(item)
}

fn unborn_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    if !head.is_symbolic_ref() {
        return None;
    }
    let target = head.symbolic_target()?;
    Some(
        target
            .strip_prefix("refs/heads/")
            .unwrap_or(target)
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Signature, Time};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aigit-dashboard-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn commit_all(repo: &Repository, message: &str, time: i64) {
        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join(format!("file-{time}.txt")), "content\n").expect("write file");
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("index write");
        let signature =
            Signature::new("tester", "tester@example.com", &Time::new(time, 0)).expect("signature");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("tree");
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .expect("commit");
    }

    #[test]
    fn invalid_path_degrades_to_invalid_item_with_error() {
        let item = collect_dashboard("Z:/nonexistent/aigit-dashboard-missing");
        assert!(!item.valid);
        assert!(item.error.is_some());
    }

    #[test]
    fn unborn_repo_reports_branch_name_and_zero_counts() {
        let dir = temp_repo_dir("unborn");
        let repo = Repository::init(&dir).expect("init");
        let mut config = repo.config().expect("config");
        config.set_bool("core.autocrlf", false).expect("autocrlf");
        drop(config);
        drop(repo);

        let item = collect_dashboard(&dir.to_string_lossy());
        assert!(item.valid);
        assert!(item.unborn);
        assert!(item.current_branch.is_some());
        assert_eq!(
            item.staged_files + item.unstaged_files + item.untracked_files,
            0
        );
    }

    #[test]
    fn dirty_counts_split_staged_unstaged_and_untracked() {
        let dir = temp_repo_dir("dirty");
        let repo = Repository::init(&dir).expect("init");
        let mut config = repo.config().expect("config");
        config.set_bool("core.autocrlf", false).expect("autocrlf");
        drop(config);
        commit_all(&repo, "feat: base", 1_700_000_000);
        drop(repo);

        let workdir = dir.join("tracked.txt");
        fs::write(&workdir, "modified\n").expect("modify tracked");
        fs::write(dir.join("new.txt"), "untracked\n").expect("add untracked");

        let item = collect_dashboard(&dir.to_string_lossy());
        assert!(item.valid);
        assert!(!item.unborn);
        assert!(item.current_branch.is_some());
        assert_eq!(item.unstaged_files, 1);
        assert_eq!(item.untracked_files, 1);
        assert_eq!(item.staged_files, 0);
        assert_eq!(item.head_summary.as_deref(), Some("feat: base"));
    }
}
