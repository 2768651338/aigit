use std::process::Command;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::MergeResult;
use super::merge::{parse_merge_output, run_git_simple};

/// Check out `hash` into the working tree, detaching HEAD (`git checkout <hash>`).
///
/// Unlike [`super::branch::switch_branch`], this targets a commit (not a
/// branch), leaving the repository in a detached-HEAD state. Used by the
/// history-view context menu's "checkout this commit" action.
pub fn checkout_commit(repo: &Repository, hash: &str) -> AppResult<String> {
    run_git_simple(repo, &["checkout", hash], "迁出提交失败")
}

/// Revert `hash` with a brand-new commit (`git revert <hash> --no-edit`).
///
/// On a clean revert this creates a new "Revert ..." commit on top of HEAD.
/// If the revert hits conflicts we automatically `git revert --abort` so the
/// repository is left clean (no in-progress sequencer state); the returned
/// [`MergeResult`] carries the conflicting file paths so the UI can surface
/// them. In-app conflict resolution for revert is intentionally not supported
/// in v1 — the operation is atomic (succeeds, or aborts cleanly).
pub fn revert_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    run_sequence_op(repo, "revert", &["revert", hash, "--no-edit"])
}

/// Apply `hash` onto the current branch (`git cherry-pick <hash>`).
///
/// Same atomic-conflict semantics as [`revert_commit`]: on conflict the
/// cherry-pick is aborted (`git cherry-pick --abort`) and the conflicting
/// paths are returned for the UI to display.
pub fn cherry_pick_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    run_sequence_op(repo, "cherry-pick", &["cherry-pick", hash])
}

/// Reset the current branch to `hash` (`git reset --<mode> <hash>`).
///
/// `mode` is one of `"soft"` / `"mixed"` / `"hard"`. A hard reset discards
/// uncommitted working-tree changes — callers MUST confirm with the user
/// before invoking this with `"hard"`.
pub fn reset_to_commit(repo: &Repository, hash: &str, mode: &str) -> AppResult<String> {
    let mode_arg = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        other => {
            return Err(AppError::General(format!("未知的 reset 模式：{other}")));
        }
    };
    run_git_simple(repo, &["reset", mode_arg, hash], "重置失败")
}

/// Run a sequencer-style operation (`revert` / `cherry-pick`) against `hash`
/// and package the outcome as a [`MergeResult`].
///
/// On conflict the in-progress operation is aborted so the worktree is left
/// clean, and the conflicting file paths are returned in `conflicts`. The
/// `message` field is left empty for the conflict case — the frontend builds
/// the localized message from the conflict list.
fn run_sequence_op(repo: &Repository, kind: &str, args: &[&str]) -> AppResult<MergeResult> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let output = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    let result = parse_merge_output(&output, kind)?;

    if result.has_conflicts {
        // Abort the in-progress sequencer so the repository is left clean.
        // Errors from the abort are ignored — the original conflict result is
        // what we want to surface, and a failed abort leaves a state the user
        // can recover from via the CLI.
        let _ = Command::new("git")
            .args([kind, "--abort"])
            .current_dir(workdir)
            .output();
        let conflicts = result.conflicts.clone();
        return Ok(MergeResult {
            success: false,
            has_conflicts: true,
            conflicts,
            message: String::new(),
        });
    }

    Ok(result)
}
