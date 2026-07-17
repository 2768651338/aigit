use std::path::Path;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::RepoInfo;

pub fn open_repo(path: &str) -> AppResult<Repository> {
    Repository::open(path).map_err(|_| AppError::NotARepo(path.to_string()))
}

pub fn discover_repo(path: &str) -> AppResult<String> {
    Repository::discover(path)
        .map(|repo| repo.workdir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default())
        .map_err(|_| AppError::NotARepo(path.to_string()))
}

pub fn init_repo(path: &str) -> AppResult<()> {
    Repository::init(Path::new(path))?;
    Ok(())
}

pub fn clone_repo(url: &str, target_path: &str) -> AppResult<()> {
    Repository::clone(url, target_path)?;
    Ok(())
}

pub fn get_repo_info(repo: &Repository) -> AppResult<RepoInfo> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let path = workdir.to_string_lossy().to_string();
    let name = workdir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let current_branch = get_current_branch_name(repo);

    let (ahead, behind) = match &current_branch {
        Some(branch) => get_ahead_behind(repo, branch).unwrap_or((0, 0)),
        None => (0, 0),
    };

    let head_hash = repo
        .head()
        .ok()
        .and_then(|h| h.target().map(|t| t.to_string()));

    Ok(RepoInfo {
        path,
        name,
        current_branch,
        ahead,
        behind,
        head_hash,
    })
}

pub fn get_current_branch_name(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|head| {
            if head.is_branch() {
                head.shorthand().map(|s| s.to_string())
            } else {
                None
            }
        })
}

fn get_ahead_behind(repo: &Repository, branch_name: &str) -> AppResult<(usize, usize)> {
    let local_branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
    let local_commit = local_branch.get().peel_to_commit()?;

    let upstream = local_branch.upstream().map_err(|_| AppError::General("No upstream".to_string()))?;
    let upstream_commit = upstream.get().peel_to_commit()?;

    let (ahead, behind) = repo.graph_ahead_behind(
        local_commit.id(),
        upstream_commit.id(),
    )?;

    Ok((ahead, behind))
}
