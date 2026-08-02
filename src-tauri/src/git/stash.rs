use git2::{Repository, StashApplyOptions};

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};
use super::StashInfo;

/// List all stash entries (most recent first).
///
/// Iterates the stash reflog via libgit2's `stash_foreach`, which reads
/// `refs/stash` and its reflog in the same order `git stash list` does.
pub fn list_stashes(repo: &mut Repository) -> AppResult<Vec<StashInfo>> {
    // Collect raw stash data first; we can't use `repo` inside the
    // `stash_foreach` closure because it already borrows `repo` mutably.
    let mut raw: Vec<(usize, String, git2::Oid)> = Vec::new();
    repo.stash_foreach(|index, msg, id| {
        raw.push((index, msg.to_string(), *id));
        true
    })?;

    // Now resolve commit timestamps (repo is no longer mutably borrowed).
    let entries = raw
        .into_iter()
        .map(|(index, message, id)| {
            let hash = id.to_string();
            let short_hash = hash.get(..7).unwrap_or(&hash).to_string();
            let date = repo
                .find_commit(id)
                .ok()
                .map(|c| c.time().seconds())
                .unwrap_or(0);
            StashInfo {
                index,
                hash,
                short_hash,
                message,
                date,
            }
        })
        .collect();

    Ok(entries)
}

/// Save current working-tree + staged changes as a new stash entry using the
/// system `git` CLI. We use the CLI (not libgit2) because libgit2's
/// `repo.stash_save` does not support the `--include-untracked` flag reliably
/// across platforms and the system git behaviour is what users expect.
pub fn stash_save(
    repo: &Repository,
    message: Option<&str>,
    include_untracked: bool,
    keep_index: bool,
) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        args.push("--include-untracked".to_string());
    }
    if keep_index {
        args.push("--keep-index".to_string());
    }
    if let Some(msg) = message {
        if !msg.trim().is_empty() {
            args.push("-m".to_string());
            args.push(msg.to_string());
        }
    }

    run_git(workdir, &args, "保存 stash 失败")
}

/// Apply a stash entry by index. Does not remove the stash from the list.
pub fn stash_apply(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "apply".to_string(), idx_str];
    run_git(workdir, &args, "应用 stash 失败")
}

/// Pop a stash entry by index (apply + drop on success).
pub fn stash_pop(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "pop".to_string(), idx_str];
    run_git(workdir, &args, "弹出 stash 失败")
}

/// Drop a stash entry by index without applying it.
pub fn stash_drop(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "drop".to_string(), idx_str];
    run_git(workdir, &args, "删除 stash 失败")
}

/// Apply a stash using libgit2 (used internally when we need fine-grained
/// control over conflict handling). Currently unused — kept for future
/// interactive-conflict-resolution flows.
#[allow(dead_code)]
fn _stash_apply_libgit2(repo: &mut Repository, index: usize) -> AppResult<()> {
    let mut opts = StashApplyOptions::default();
    repo.stash_apply(index, Some(&mut opts))?;
    Ok(())
}

fn run_git(workdir: &std::path::Path, args: &[String], err_prefix: &str) -> AppResult<String> {
    cli::run_checked(workdir, args.iter().cloned(), LOCAL_TIMEOUT, err_prefix)
}
