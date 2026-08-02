use git2::Repository;

use crate::error::AppResult;

use super::cli::{self, GitOutput, LOCAL_TIMEOUT};
use super::MergeResult;

/// Merge `branch` into the current branch using the system `git` CLI.
pub fn merge_branch(repo: &Repository, branch: &str, no_ff: bool) -> AppResult<MergeResult> {
    cli::validate_non_option(branch, "分支名")?;
    let workdir = cli::workdir(repo)?;

    let mut args = vec!["merge".to_string()];
    if no_ff {
        args.push("--no-ff".to_string());
    }
    args.push("--no-edit".to_string());
    args.push("--".to_string());
    args.push(branch.to_string());

    let output = cli::run(workdir, args, LOCAL_TIMEOUT)?;
    operation_result(workdir, output, "merge")
}

/// Rebase the current branch onto `branch` using the system `git` CLI.
pub fn rebase_branch(repo: &Repository, branch: &str) -> AppResult<MergeResult> {
    cli::validate_non_option(branch, "分支名")?;
    let workdir = cli::workdir(repo)?;
    let output = cli::run(workdir, ["rebase", "--", branch], LOCAL_TIMEOUT)?;
    operation_result(workdir, output, "rebase")
}

/// Abort an in-progress merge (`git merge --abort`).
pub fn abort_merge(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, ["merge", "--abort"], "取消 merge 失败")
}

/// Abort an in-progress rebase (`git rebase --abort`).
pub fn abort_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, ["rebase", "--abort"], "取消 rebase 失败")
}

/// Continue an in-progress merge after conflicts have been resolved.
pub fn continue_merge(repo: &Repository) -> AppResult<String> {
    run_git_simple(
        repo,
        ["merge", "--continue", "--no-edit"],
        "继续 merge 失败",
    )
}

/// Continue an in-progress rebase after conflicts have been resolved.
pub fn continue_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, ["rebase", "--continue"], "继续 rebase 失败")
}

/// Skip the current commit during an in-progress rebase.
pub fn skip_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, ["rebase", "--skip"], "跳过 rebase 提交失败")
}

/// Returns `true` if a merge is in progress (i.e. `MERGE_HEAD` exists).
pub fn is_merging(repo: &Repository) -> bool {
    repo.path().join("MERGE_HEAD").exists()
}

/// Returns `true` if a rebase is in progress.
pub fn is_rebasing(repo: &Repository) -> bool {
    let gitdir = repo.path();
    gitdir.join("rebase-merge").exists() || gitdir.join("rebase-apply").exists()
}

/// Resolve conflicts to "ours" strategy for the given paths (or all when empty).
pub fn resolve_ours(repo: &Repository, paths: &[String]) -> AppResult<String> {
    resolve_with_strategy(repo, paths, "--ours", "采用 ours 解决冲突失败")?;
    Ok("已采用 ours 解决冲突并暂存".to_string())
}

/// Resolve conflicts to "theirs" strategy for the given paths (or all when empty).
pub fn resolve_theirs(repo: &Repository, paths: &[String]) -> AppResult<String> {
    resolve_with_strategy(repo, paths, "--theirs", "采用 theirs 解决冲突失败")?;
    Ok("已采用 theirs 解决冲突并暂存".to_string())
}

/// List files with unresolved index entries using a NUL-delimited structured command.
pub fn list_conflicted_files(repo: &Repository) -> AppResult<Vec<String>> {
    list_conflicted_files_in(cli::workdir(repo)?)
}

pub(crate) fn run_git_simple<I, S>(
    repo: &Repository,
    args: I,
    error_prefix: &str,
) -> AppResult<String>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    cli::run_checked(cli::workdir(repo)?, args, LOCAL_TIMEOUT, error_prefix)
}

pub(crate) fn operation_result(
    workdir: &std::path::Path,
    output: GitOutput,
    kind: &str,
) -> AppResult<MergeResult> {
    let conflicts = list_conflicted_files_in(workdir)?;
    let has_conflicts = !conflicts.is_empty();
    let success = output.success() && !has_conflicts;
    let combined = output.combined_lossy();

    let message = if has_conflicts {
        if combined.is_empty() {
            format!("{kind} 过程中出现冲突，请手动解决后继续")
        } else {
            format!("{kind} 过程中出现冲突，请手动解决后继续：\n{combined}")
        }
    } else if success {
        combined
    } else {
        let code = output
            .status_code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "被信号终止".to_string());
        if combined.is_empty() {
            format!("{kind} 失败（git 状态码：{code}）")
        } else {
            format!("{kind} 失败（git 状态码：{code}）：\n{combined}")
        }
    };

    Ok(MergeResult {
        success,
        message,
        has_conflicts,
        conflicts,
    })
}

fn resolve_with_strategy(
    repo: &Repository,
    paths: &[String],
    strategy: &str,
    error_prefix: &str,
) -> AppResult<()> {
    let workdir = cli::workdir(repo)?;
    let selected = validated_paths(paths)?;
    let details = super::conflict::list_conflict_details(repo)?;

    for path in selected {
        let stage_exists = details
            .iter()
            .find(|entry| entry.path == path)
            .map(|entry| {
                if strategy == "--ours" {
                    entry.ours.is_some()
                } else {
                    entry.theirs.is_some()
                }
            })
            .unwrap_or(true);
        if stage_exists {
            cli::run_checked(
                workdir,
                ["checkout", strategy, "--", path.as_str()],
                LOCAL_TIMEOUT,
                error_prefix,
            )?;
            cli::run_checked(
                workdir,
                ["add", "--", path.as_str()],
                LOCAL_TIMEOUT,
                "暂存解决后的文件失败",
            )?;
        } else {
            cli::run_checked(
                workdir,
                ["rm", "-f", "--", path.as_str()],
                LOCAL_TIMEOUT,
                "按所选一侧删除冲突路径失败",
            )?;
        }
    }
    Ok(())
}

fn validated_paths(paths: &[String]) -> AppResult<Vec<String>> {
    if paths.is_empty() {
        return Ok(vec![".".to_string()]);
    }
    for path in paths {
        cli::validate_pathspec(path, "冲突文件路径")?;
    }
    Ok(paths.to_vec())
}

fn list_conflicted_files_in(workdir: &std::path::Path) -> AppResult<Vec<String>> {
    let output = cli::run(
        workdir,
        ["diff", "--name-only", "--diff-filter=U", "-z"],
        LOCAL_TIMEOUT,
    )?;
    if !output.success() {
        return Err(cli::command_failed("读取冲突文件失败", &output));
    }

    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_conflict_selection_targets_worktree() {
        assert_eq!(validated_paths(&[]).unwrap(), vec!["."]);
    }

    #[test]
    fn conflict_paths_may_start_with_dash_because_pathspec_separator_is_used() {
        assert!(validated_paths(&["-odd-name.txt".to_string()]).is_ok());
    }

    #[test]
    fn conflict_paths_reject_empty_values() {
        assert!(validated_paths(&["".to_string()]).is_err());
    }
}
