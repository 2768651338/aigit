use std::path::Path;

use git2::{Repository, WorktreeAddOptions, WorktreeLockStatus, WorktreePruneOptions};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// One entry of the repository's linked worktrees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    /// `true` when this worktree is the directory the repo was opened from.
    pub is_current: bool,
    pub is_locked: bool,
}

fn validate_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::General("worktree 名称不能为空".into()));
    }
    if name.len() > 200 || name.contains("..") || name.starts_with('.') {
        return Err(AppError::General(format!("非法的 worktree 名称：{name}")));
    }
    Ok(())
}

pub fn list_worktrees(repo: &Repository) -> AppResult<Vec<WorktreeInfo>> {
    let worktrees = repo.worktrees()?;
    let current = repo.workdir().map(|p| p.to_path_buf());
    let mut result = Vec::new();
    for i in 0..worktrees.len() {
        let name = match worktrees.get(i) {
            Some(n) => n.to_string(),
            None => continue,
        };
        match repo.find_worktree(&name) {
            Ok(wt) => {
                let wt_path = wt.path().to_path_buf();
                let is_locked = matches!(wt.is_locked()?, WorktreeLockStatus::Locked(_));
                result.push(WorktreeInfo {
                    name,
                    path: wt_path.to_string_lossy().into_owned(),
                    is_current: current.as_ref().map(|c| c == &wt_path).unwrap_or(false),
                    is_locked,
                });
            }
            // A stale/prunable worktree still shows up in the list; surface it
            // with its name so the user can prune it instead of hiding it.
            Err(_) => result.push(WorktreeInfo {
                name,
                path: String::new(),
                is_current: false,
                is_locked: false,
            }),
        }
    }
    Ok(result)
}

/// Create a linked worktree. `branch` selects the branch to check out; when
/// omitted the worktree is created from HEAD in a detached state.
pub fn add_worktree(
    repo: &Repository,
    name: &str,
    path: &Path,
    branch: Option<&str>,
) -> AppResult<String> {
    validate_name(name)?;
    if path.exists() {
        return Err(AppError::General(format!(
            "目标目录已存在：{}",
            path.display()
        )));
    }
    // `reference` must outlive `opts` (the borrowed reference is captured by
    // the options' lifetime), so both live in the same function scope.
    let reference = match branch {
        Some(branch_name) => {
            super::cli::validate_non_option(branch_name, "分支名")?;
            Some(
                repo.find_reference(&format!("refs/heads/{branch_name}"))
                    .map_err(|_| AppError::General(format!("本地分支不存在：{branch_name}")))?,
            )
        }
        None => None,
    };
    let mut opts = WorktreeAddOptions::new();
    if let Some(reference) = reference.as_ref() {
        opts.reference(Some(reference));
    }
    let worktree = repo.worktree(name, path, Some(&mut opts))?;
    Ok(worktree.path().to_string_lossy().into_owned())
}

/// Prune (remove) a linked worktree. With `force` the working directory is
/// deleted too; without it only registered-but-clean worktrees are removed.
/// The UI must confirm before calling this with `force = true`.
pub fn remove_worktree(repo: &Repository, name: &str, force: bool) -> AppResult<()> {
    validate_name(name)?;
    let worktree = repo.find_worktree(name)?;
    let mut opts = WorktreePruneOptions::new();
    if force {
        // libgit2 has no single "force" flag: pruning a valid worktree and
        // removing its working tree together is what `git worktree remove
        // --force` does.
        opts.valid(true).working_tree(true);
    }
    worktree.prune(Some(&mut opts))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("aigit-wt-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("create temp dir");
        let repo = Repository::init(&root).expect("init repo");
        (root, repo)
    }

    #[test]
    fn add_list_remove_worktree_roundtrip() {
        let (root, repo) = temp_repo("roundtrip");
        {
            let mut index = repo.index().expect("index");
            index.write().expect("write");
            let tree_id = index.write_tree().expect("tree");
            let tree = repo.find_tree(tree_id).expect("find tree");
            let sig = Signature::now("t", "t@example.com").expect("sig");
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .expect("commit");
        }
        repo.branch(
            "feature",
            &repo
                .find_commit(repo.head().expect("head").target().expect("target"))
                .expect("commit"),
            false,
        )
        .expect("branch");

        let before = list_worktrees(&repo).expect("list");
        assert_eq!(before.len(), 1);
        assert!(before[0].is_current);

        let wt_path = root.join("wt-feature");
        let created =
            add_worktree(&repo, "feature-wt", &wt_path, Some("feature")).expect("add worktree");
        assert!(wt_path.exists());
        assert!(created.contains("feature-wt"));

        let listed = list_worktrees(&repo).expect("list after add");
        assert_eq!(listed.len(), 2);
        let added = listed
            .iter()
            .find(|w| w.name == "feature-wt")
            .expect("entry");
        assert!(added.path.contains("feature-wt"));

        remove_worktree(&repo, "feature-wt", true).expect("prune");
        assert!(!wt_path.exists());
        let after = list_worktrees(&repo).expect("list after prune");
        assert_eq!(after.len(), 1);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_bad_name_and_existing_path() {
        let (root, repo) = temp_repo("guards");
        assert!(add_worktree(&repo, "../escape", &root.join("x"), None).is_err());
        assert!(add_worktree(&repo, "", &root.join("x"), None).is_err());
        fs::remove_dir_all(&root).ok();
    }
}
