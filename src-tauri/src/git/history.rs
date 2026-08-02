use git2::Repository;

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};
use super::merge::{operation_result, run_git_simple};
use super::MergeResult;

/// Check out `hash` into the working tree, detaching HEAD (`git checkout <hash>`).
pub fn checkout_commit(repo: &Repository, hash: &str) -> AppResult<String> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_git_simple(repo, ["checkout", "--detach", hash], "迁出提交失败")
}

/// Revert `hash` with a brand-new commit (`git revert <hash> --no-edit`).
pub fn revert_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_sequence_op(repo, "revert", ["revert", "--no-edit", "--", hash])
}

/// Apply `hash` onto the current branch (`git cherry-pick <hash>`).
pub fn cherry_pick_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_sequence_op(repo, "cherry-pick", ["cherry-pick", "--", hash])
}

/// Reset the current branch to `hash` (`git reset --<mode> <hash>`).
pub fn reset_to_commit(repo: &Repository, hash: &str, mode: &str) -> AppResult<String> {
    cli::validate_non_option(hash, "提交哈希")?;
    let mode_arg = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        other => return Err(AppError::General(format!("未知的 reset 模式：{other}"))),
    };
    run_git_simple(repo, ["reset", mode_arg, hash], "重置失败")
}

fn run_sequence_op<I, S>(repo: &Repository, kind: &str, args: I) -> AppResult<MergeResult>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    let workdir = cli::workdir(repo)?;
    let output = cli::run(workdir, args, LOCAL_TIMEOUT)?;
    operation_result(workdir, output, kind)
}
