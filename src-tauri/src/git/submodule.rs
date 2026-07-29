use std::path::Path;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::SubmoduleInfo;

/// List all submodules registered in `.gitmodules`, including their current
/// HEAD OID and status.
///
/// We delegate enumeration to libgit2's `submodules()` iterator, which reads
/// `.gitmodules` and the index state. The status is computed by comparing the
/// recorded OID in the superproject's index against the submodule's actual
/// HEAD — when they differ, the submodule is "modified".
pub fn list_submodules(repo: &Repository) -> AppResult<Vec<SubmoduleInfo>> {
    // Collect basic submodule data from the iterator first, then resolve
    // status separately via `repo.submodule_status()` to avoid using the
    // `Submodule::status()` method (not available in git2 0.19).
    let subs: Vec<(String, String, String)> = repo
        .submodules()?
        .into_iter()
        .map(|sub| {
            let name = sub.name().unwrap_or("").to_string();
            let path = sub.path().to_string_lossy().to_string();
            let url = sub.url().unwrap_or("").to_string();
            (name, path, url)
        })
        .collect();

    let mut entries = Vec::new();
    for (name, path, url) in subs {
        // Resolve status via the repository API.
        let status = if name.is_empty() {
            "unknown".to_string()
        } else {
            match repo.submodule_status(&name, git2::SubmoduleIgnore::None) {
                Ok(s) => {
                    if s.contains(git2::SubmoduleStatus::WD_UNINITIALIZED) {
                        "uninitialized".to_string()
                    } else if s.contains(git2::SubmoduleStatus::WD_MODIFIED)
                        || s.contains(git2::SubmoduleStatus::INDEX_MODIFIED)
                    {
                        "modified".to_string()
                    } else if s.contains(git2::SubmoduleStatus::WD_DELETED) {
                        "deleted".to_string()
                    } else {
                        "unchanged".to_string()
                    }
                }
                Err(_) => "unknown".to_string(),
            }
        };

        // head_oid: try to read the superproject's recorded gitlink OID.
        let head_oid = repo
            .find_submodule(&name)
            .ok()
            .and_then(|s| s.head_id())
            .map(|oid| oid.to_string())
            .unwrap_or_default();
        let short_hash = head_oid.get(..7).unwrap_or(&head_oid).to_string();

        entries.push(SubmoduleInfo {
            name,
            path,
            head_oid,
            short_hash,
            url,
            status,
        });
    }

    // Sort by path for stable display.
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

/// Update a single submodule (init + update) using the system `git` CLI.
///
/// libgit2's submodule API does not provide a high-level "update" that pulls
/// the missing commits and checks out the recorded OID — it's a multi-step
/// dance that the CLI does in one shot. The CLI also correctly handles
/// `submodule.<name>.update=checkout` config from `.gitmodules`.
pub fn update_submodule(repo: &Repository, name: Option<&str>) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["submodule".to_string(), "update".to_string(), "--init".to_string(), "--recursive".to_string()];
    if let Some(n) = name {
        if !n.trim().is_empty() {
            args.push("--".to_string());
            args.push(n.to_string());
        }
    }

    run_git(workdir, &args, "更新子模块失败")
}

/// Add a new submodule at `url` into `path` (relative to the superproject
/// workdir). Delegates to `git submodule add` — libgit2 has no public helper
/// for this workflow.
pub fn add_submodule(repo: &Repository, url: &str, path: &str, branch: Option<&str>) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["submodule".to_string(), "add".to_string()];
    if let Some(b) = branch {
        if !b.trim().is_empty() {
            args.push("-b".to_string());
            args.push(b.to_string());
        }
    }
    args.push(url.to_string());
    args.push(path.to_string());

    run_git(workdir, &args, "添加子模块失败")
}

/// Deinitialize + remove a submodule from the index and `.gitmodules`.
/// Mirrors the standard manual recipe used by `git`:
///   1. `git submodule deinit -f <name>`
///   2. `git rm -f <path>`
///   3. rm -rf .git/modules/<name>
pub fn remove_submodule(repo: &Repository, name: &str) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    // 1. deinit
    let deinit_args = vec![
        "submodule".to_string(),
        "deinit".to_string(),
        "-f".to_string(),
        name.to_string(),
    ];
    run_git(workdir, &deinit_args, "停用子模块失败")?;

    // 2. git rm
    let rm_args = vec!["rm".to_string(), "-f".to_string(), name.to_string()];
    run_git(workdir, &rm_args, "移除子模块索引失败")?;

    // 3. remove .git/modules/<name>
    let git_dir = repo.path();
    let modules_path = git_dir.join("modules").join(name);
    if modules_path.exists() {
        std::fs::remove_dir_all(&modules_path).map_err(|e| {
            AppError::General(format!(
                "无法删除子模块 git 目录 {}: {e}",
                modules_path.display()
            ))
        })?;
    }

    Ok(format!("子模块 {name} 已移除"))
}

fn run_git(
    workdir: &Path,
    args: &[String],
    err_prefix: &str,
) -> AppResult<String> {
    let output = std::process::Command::new("git")
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
