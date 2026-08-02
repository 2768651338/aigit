use std::path::{Component, Path, PathBuf};

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::cli::{self, REMOTE_TIMEOUT};
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

    let mut args = vec![
        "submodule".to_string(),
        "update".to_string(),
        "--init".to_string(),
        "--recursive".to_string(),
    ];
    if let Some(n) = name {
        if !n.trim().is_empty() {
            cli::validate_pathspec(n, "子模块路径")?;
            args.push("--".to_string());
            args.push(n.to_string());
        }
    }

    run_git(workdir, &args, "更新子模块失败")
}

/// Add a new submodule at `url` into `path` (relative to the superproject
/// workdir). Delegates to `git submodule add` — libgit2 has no public helper
/// for this workflow.
pub fn add_submodule(
    repo: &Repository,
    url: &str,
    path: &str,
    branch: Option<&str>,
) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    cli::validate_non_option(url, "子模块 URL")?;
    cli::validate_pathspec(path, "子模块路径")?;
    let mut args = vec!["submodule".to_string(), "add".to_string()];
    if let Some(b) = branch {
        if !b.trim().is_empty() {
            cli::validate_non_option(b, "子模块分支")?;
            args.push("-b".to_string());
            args.push(b.to_string());
        }
    }
    args.push("--".to_string());
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

    cli::validate_pathspec(name, "子模块名称")?;
    let registered = repo
        .find_submodule(name)
        .map_err(|_| AppError::General(format!("只能移除已注册的子模块，未找到：{name}")))?;
    let submodule_path = normalize_relative_path(registered.path(), "子模块路径")?;
    let modules_path = normalize_relative_path(Path::new(name), "子模块名称")?;
    ensure_contained(workdir, &submodule_path, "子模块路径")?;

    let submodule_arg = submodule_path.to_string_lossy().into_owned();
    let deinit_args = vec![
        "submodule".to_string(),
        "deinit".to_string(),
        "-f".to_string(),
        "--".to_string(),
        submodule_arg.clone(),
    ];
    run_git(workdir, &deinit_args, "停用子模块失败")?;

    let rm_args = vec![
        "rm".to_string(),
        "-f".to_string(),
        "--".to_string(),
        submodule_arg.clone(),
    ];
    run_git(workdir, &rm_args, "移除子模块索引失败")?;

    let modules_root = repo.path().join("modules");
    let modules_root_canonical = canonicalize_existing_ancestor(&modules_root)?;
    let module_git_dir = modules_root.join(modules_path);
    if module_git_dir.exists() {
        let module_git_dir_canonical = module_git_dir.canonicalize().map_err(|error| {
            AppError::General(format!(
                "无法规范化子模块 git 目录 {}: {error}",
                module_git_dir.display()
            ))
        })?;
        if module_git_dir_canonical == modules_root_canonical
            || !module_git_dir_canonical.starts_with(&modules_root_canonical)
        {
            return Err(AppError::General(format!(
                "拒绝删除仓库 modules 目录之外的路径：{}",
                module_git_dir.display()
            )));
        }
        std::fs::remove_dir_all(&module_git_dir_canonical).map_err(|error| {
            AppError::General(format!(
                "无法删除子模块 git 目录 {}: {error}",
                module_git_dir_canonical.display()
            ))
        })?;
    }

    Ok(format!("子模块 {submodule_arg} 已移除"))
}

fn normalize_relative_path(path: &Path, label: &str) -> AppResult<PathBuf> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(AppError::General(format!("{label}必须是非空相对路径")));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::General(format!("{label}不能逃逸仓库目录")));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(AppError::General(format!("{label}必须是非空相对路径")));
    }
    Ok(normalized)
}

fn ensure_contained(root: &Path, relative: &Path, label: &str) -> AppResult<()> {
    let root = root.canonicalize().map_err(|error| {
        AppError::General(format!("无法规范化仓库目录 {}: {error}", root.display()))
    })?;
    let candidate = root.join(relative);
    let canonical = canonicalize_existing_ancestor(&candidate)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::General(format!("{label}不能逃逸仓库目录")));
    }
    Ok(())
}

fn canonicalize_existing_ancestor(path: &Path) -> AppResult<PathBuf> {
    let mut ancestor = path;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(|| {
            AppError::General(format!("路径没有可规范化的父目录：{}", path.display()))
        })?;
    }
    ancestor
        .canonicalize()
        .map_err(|error| AppError::General(format!("无法规范化路径 {}: {error}", path.display())))
}

fn run_git(workdir: &Path, args: &[String], err_prefix: &str) -> AppResult<String> {
    cli::run_checked(workdir, args.iter().cloned(), REMOTE_TIMEOUT, err_prefix)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("aigit-submodule-{name}-{unique}"))
    }

    #[test]
    fn rejects_absolute_and_parent_submodule_paths() {
        assert!(normalize_relative_path(Path::new("nested/module"), "path").is_ok());
        assert!(normalize_relative_path(Path::new("../outside"), "path").is_err());
        assert!(normalize_relative_path(Path::new("nested/../../outside"), "path").is_err());
        assert!(normalize_relative_path(Path::new("/outside"), "path").is_err());
    }

    #[test]
    fn containment_rejects_paths_outside_repository() {
        let root = temp_dir("containment");
        fs::create_dir_all(&root).expect("create root");

        assert!(ensure_contained(&root, Path::new("nested/module"), "path").is_ok());
        assert!(ensure_contained(&root, Path::new("../outside"), "path").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_rejects_unregistered_submodule_before_running_git() {
        let root = temp_dir("unregistered");
        fs::create_dir_all(&root).expect("create root");
        let repo = Repository::init(&root).expect("init repository");

        let error = remove_submodule(&repo, "not-registered").expect_err("must reject");
        assert!(error.to_string().contains("已注册"));
        let _ = fs::remove_dir_all(root);
    }
}
