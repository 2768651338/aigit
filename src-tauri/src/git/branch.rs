use git2::{BranchType, Repository};

use crate::error::AppResult;

use super::{BranchInfo, LogEntry};

pub fn list_branches(repo: &Repository) -> AppResult<Vec<BranchInfo>> {
    let mut branches = Vec::new();
    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let local_branches = repo.branches(Some(BranchType::Local))?;
    for branch in local_branches {
        let (b, _) = branch?;
        let name = b.name()?.unwrap_or("").to_string();
        let is_current = current.as_deref() == Some(name.as_str());

        let commit = b.get().peel_to_commit()?;
        let upstream = b.upstream().ok().and_then(|u| {
            u.name().ok().flatten().map(|s| s.to_string())
        });

        branches.push(BranchInfo {
            name: name.clone(),
            is_current,
            is_remote: false,
            upstream,
            last_commit_hash: commit.id().to_string(),
            last_commit_message: commit.summary().unwrap_or("").to_string(),
            last_commit_date: commit.time().seconds(),
        });
    }

    let remote_branches = repo.branches(Some(BranchType::Remote))?;
    for branch in remote_branches {
        let (b, _) = branch?;
        let name = b.name()?.unwrap_or("").to_string();
        let commit = b.get().peel_to_commit()?;

        branches.push(BranchInfo {
            name,
            is_current: false,
            is_remote: true,
            upstream: None,
            last_commit_hash: commit.id().to_string(),
            last_commit_message: commit.summary().unwrap_or("").to_string(),
            last_commit_date: commit.time().seconds(),
        });
    }

    Ok(branches)
}

pub fn create_branch(repo: &Repository, name: &str) -> AppResult<()> {
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    repo.branch(name, &commit, false)?;
    Ok(())
}

pub fn switch_branch(repo: &Repository, name: &str) -> AppResult<()> {
    let refname = format!("refs/heads/{name}");
    repo.set_head(&refname)?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))?;
    Ok(())
}

pub fn delete_branch(repo: &Repository, name: &str) -> AppResult<()> {
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    branch.delete()?;
    Ok(())
}

pub fn get_log(repo: &Repository, limit: usize) -> AppResult<Vec<LogEntry>> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;

    let ref_map = build_ref_map(repo)?;

    let mut entries = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let hash = oid.to_string();
        let short_hash = hash[..7].to_string();
        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

        let refs = ref_map.get(&hash).cloned().unwrap_or_default();

        entries.push(LogEntry {
            hash,
            short_hash,
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parents,
            refs,
        });
    }

    Ok(entries)
}

fn build_ref_map(repo: &Repository) -> AppResult<std::collections::HashMap<String, Vec<String>>> {
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

    for reference in repo.references()? {
        let reference = reference?;
        if let Some(name) = reference.shorthand() {
            if let Some(target) = reference.target() {
                map.entry(target.to_string())
                    .or_default()
                    .push(name.to_string());
            }
        }
    }

    Ok(map)
}

pub fn get_commit_diff(repo: &Repository, hash: &str) -> AppResult<String> {
    let oid = git2::Oid::from_str(hash)?;
    let commit = repo.find_commit(oid)?;

    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;

    let diff = match parent_tree {
        Some(ref pt) => repo.diff_tree_to_tree(Some(pt), Some(&tree), None)?,
        None => repo.diff_tree_to_tree(None, Some(&tree), None)?,
    };

    let mut text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        text.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;

    Ok(text)
}
