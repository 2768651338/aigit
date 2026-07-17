use git2::{IndexAddOption, Repository, Signature};

use crate::error::{AppError, AppResult};

pub fn stage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let mut index = repo.index()?;
    if paths.is_empty() {
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    } else {
        for path in paths {
            index.add_path(std::path::Path::new(path))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn stage_all(repo: &Repository) -> AppResult<()> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let head = repo.head()?;
    let head_commit = head.peel_to_commit()?;
    let head_obj = repo.find_object(head_commit.id(), None)?;

    if paths.is_empty() {
        repo.reset_default(Some(&head_obj), &["*"])?;
    } else {
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        repo.reset_default(Some(&head_obj), &path_refs)?;
    }

    Ok(())
}

pub fn commit(repo: &Repository, message: &str) -> AppResult<String> {
    let sig = repo.signature().or_else(|_| {
        Signature::now("aigit", "aigit@local").map_err(|e| AppError::Git(e))
    })?;

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let head = repo.head()?;
    let parent_commit = head.peel_to_commit()?;

    let commit_oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        &[&parent_commit],
    )?;

    Ok(commit_oid.to_string())
}

pub fn amend_message(repo: &Repository, message: &str) -> AppResult<String> {
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    let sig = repo.signature()?;

    let oid = commit.amend(
        Some("HEAD"),
        Some(&sig),
        Some(&sig),
        None,
        Some(message),
        None,
    )?;

    Ok(oid.to_string())
}
