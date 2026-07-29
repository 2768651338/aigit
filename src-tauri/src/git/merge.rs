use std::path::Path;
use std::process::Command;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::MergeResult;

/// Merge `branch` into the current branch using the system `git` CLI.
///
/// We use the CLI (not libgit2's `MergeOptions`) because libgit2's merge API
/// only performs the merge in-memory and leaves the caller to commit, resolve
/// conflicts, and update the index — a fragile dance on Windows. The system
/// `git merge` does all of this correctly and consistently with what users
/// expect from the CLI.
///
/// `no_ff` controls `--no-ff` (force a merge commit even when a fast-forward
/// is possible). Returns a [`MergeResult`] describing the outcome.
pub fn merge_branch(repo: &Repository, branch: &str, no_ff: bool) -> AppResult<MergeResult> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["merge".to_string()];
    if no_ff {
        args.push("--no-ff".to_string());
    }
    // Emit a machine-readable conflict block we can parse.
    args.push("--no-edit".to_string());
    args.push(branch.to_string());

    let output = Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    parse_merge_output(&output, "merge")
}

/// Rebase the current branch onto `branch` using the system `git` CLI.
pub fn rebase_branch(repo: &Repository, branch: &str) -> AppResult<MergeResult> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let args = vec!["rebase".to_string(), branch.to_string()];

    let output = Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    parse_merge_output(&output, "rebase")
}

/// Abort an in-progress merge (`git merge --abort`).
pub fn abort_merge(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, &["merge", "--abort"], "取消 merge 失败")
}

/// Abort an in-progress rebase (`git rebase --abort`).
pub fn abort_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, &["rebase", "--abort"], "取消 rebase 失败")
}

/// Continue an in-progress merge after conflicts have been resolved.
pub fn continue_merge(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, &["merge", "--continue", "--no-edit"], "继续 merge 失败")
}

/// Continue an in-progress rebase after conflicts have been resolved.
pub fn continue_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, &["rebase", "--continue"], "继续 rebase 失败")
}

/// Skip the current commit during an in-progress rebase.
pub fn skip_rebase(repo: &Repository) -> AppResult<String> {
    run_git_simple(repo, &["rebase", "--skip"], "跳过 rebase 提交失败")
}

/// Returns `true` if a merge is in progress (i.e. `MERGE_HEAD` exists).
pub fn is_merging(repo: &Repository) -> bool {
    repo.path().join("MERGE_HEAD").exists()
}

/// Returns `true` if a rebase is in progress (any of the rebase state dirs
/// exists under `.git`).
pub fn is_rebasing(repo: &Repository) -> bool {
    let gitdir = repo.path();
    gitdir.join("rebase-merge").exists() || gitdir.join("rebase-apply").exists()
}

/// Resolve conflicts to "ours" strategy for the given paths (or all when
/// `paths` is empty). Useful for quick conflict resolution in bulk.
pub fn resolve_ours(repo: &Repository, paths: &[String]) -> AppResult<String> {
    let mut args = vec!["checkout".to_string(), "--ours".to_string(), "--".to_string()];
    if paths.is_empty() {
        args.push(".".to_string());
    } else {
        for p in paths {
            args.push(p.clone());
        }
    }
    run_git_simple_raw(repo, &args, "采用 ours 解决冲突失败")?;
    // After checkout, stage the resolved paths.
    let mut add_args = vec!["add".to_string()];
    if paths.is_empty() {
        add_args.push(".".to_string());
    } else {
        for p in paths {
            add_args.push(p.clone());
        }
    }
    run_git_simple_raw(repo, &add_args, "暂存解决后的文件失败")?;
    Ok("已采用 ours 解决冲突并暂存".to_string())
}

/// Resolve conflicts to "theirs" strategy for the given paths (or all when
/// `paths` is empty).
pub fn resolve_theirs(repo: &Repository, paths: &[String]) -> AppResult<String> {
    let mut args = vec!["checkout".to_string(), "--theirs".to_string(), "--".to_string()];
    if paths.is_empty() {
        args.push(".".to_string());
    } else {
        for p in paths {
            args.push(p.clone());
        }
    }
    run_git_simple_raw(repo, &args, "采用 theirs 解决冲突失败")?;
    let mut add_args = vec!["add".to_string()];
    if paths.is_empty() {
        add_args.push(".".to_string());
    } else {
        for p in paths {
            add_args.push(p.clone());
        }
    }
    run_git_simple_raw(repo, &add_args, "暂存解决后的文件失败")?;
    Ok("已采用 theirs 解决冲突并暂存".to_string())
}

/// List files with unresolved conflicts (`git diff --name-only --diff-filter=U`).
pub fn list_conflicted_files(repo: &Repository) -> AppResult<Vec<String>> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let args = ["diff".to_string(), "--name-only".to_string(), "--diff-filter=U".to_string()];
    let output = Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let files: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(files)
}

// --- helpers ---

fn run_git_simple(repo: &Repository, args: &[&str], err_prefix: &str) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    run_git_with_workdir(workdir, args, err_prefix)
}

fn run_git_simple_raw(repo: &Repository, args: &[String], err_prefix: &str) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git_with_workdir(workdir, &str_args, err_prefix)
}

fn run_git_with_workdir(
    workdir: &Path,
    args: &[&str],
    err_prefix: &str,
) -> AppResult<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let msg = if stderr.trim().is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        return Err(AppError::General(format!("{err_prefix}：\n{msg}")));
    }

    let combined = if stdout.trim().is_empty() {
        stderr
    } else if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok(combined.trim().to_string())
}

/// Parse the output of a merge/rebase command into a structured result.
///
/// `git merge` and `git rebase` print conflict markers to stderr like:
///   CONFLICT (content): Merge conflict in <file>
/// We scan for these lines to extract conflicted file paths.
fn parse_merge_output(output: &std::process::Output, kind: &str) -> AppResult<MergeResult> {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let combined = if stdout.trim().is_empty() {
        stderr.clone()
    } else if stderr.trim().is_empty() {
        stdout.clone()
    } else {
        format!("{stdout}\n{stderr}")
    };

    // Extract conflicted file paths from `CONFLICT ... conflict in <file>` lines.
    let mut conflicts = Vec::new();
    for line in combined.lines() {
        let l = line.trim();
        if l.starts_with("CONFLICT") {
            if let Some(idx) = l.rfind(" in ") {
                let file = l[idx + 4..].trim().to_string();
                if !file.is_empty() {
                    conflicts.push(file);
                }
            }
        }
    }

    let has_conflicts = !conflicts.is_empty();
    let success = output.status.success() && !has_conflicts;

    let message = if has_conflicts {
        format!(
            "{kind} 过程中出现冲突，请手动解决后继续：\n{}",
            combined.trim()
        )
    } else if success {
        combined.trim().to_string()
    } else {
        format!("{kind} 失败：\n{}", combined.trim())
    };

    Ok(MergeResult {
        success,
        message,
        has_conflicts,
        conflicts,
    })
}
