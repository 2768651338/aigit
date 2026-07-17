use std::path::Path;
use std::process::Command;

use git2::Repository;

use crate::error::{AppError, AppResult};

/// Push current branch to its upstream remote using the system `git` CLI.
///
/// We intentionally use the system git rather than libgit2's `Remote::push`
/// because libgit2 has no built-in support for SSH agent forwarding,
/// Windows credential helper, or the user's global ~/.gitconfig credentials.
/// Calling the system `git push` reuses whatever auth the user has already
/// configured (SSH keys, credential.helper, etc.), which is far more
/// reliable across platforms.
pub fn push_current_branch(repo: &Repository, set_upstream: bool) -> AppResult<String> {
    // Resolve the current branch name.
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| AppError::Git(git2::Error::from_str("HEAD is not a named ref")))?
        .to_string();

    // Resolve the workdir to run git in.
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    push_branch(workdir, &branch_name, set_upstream)
}

/// Push a specific branch to its upstream using the system `git` CLI.
pub fn push_branch(workdir: &Path, branch: &str, set_upstream: bool) -> AppResult<String> {
    let mut args = vec!["push".to_string()];
    if set_upstream {
        args.push("-u".to_string());
    }
    args.push("origin".to_string());
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

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let msg = if stderr.trim().is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        return Err(AppError::General(format!(
            "推送失败（分支 {branch}）：\n{msg}"
        )));
    }

    // Combine for user-facing result. Prefer stderr because git writes
    // progress info (e.g. "Writing objects: 100%") to stderr.
    let combined = if stdout.trim().is_empty() {
        stderr
    } else if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };

    Ok(combined.trim().to_string())
}
