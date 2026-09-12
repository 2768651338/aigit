use git2::{Repository, StashApplyOptions};

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};
use super::StashInfo;

/// List all stash entries (most recent first).
///
/// Iterates the stash reflog via libgit2's `stash_foreach`, which reads
/// `refs/stash` and its reflog in the same order `git stash list` does.
pub fn list_stashes(repo: &mut Repository) -> AppResult<Vec<StashInfo>> {
    // Collect raw stash data first; we can't use `repo` inside the
    // `stash_foreach` closure because it already borrows `repo` mutably.
    let mut raw: Vec<(usize, String, git2::Oid)> = Vec::new();
    repo.stash_foreach(|index, msg, id| {
        raw.push((index, msg.to_string(), *id));
        true
    })?;

    // Now resolve commit timestamps (repo is no longer mutably borrowed).
    let entries = raw
        .into_iter()
        .map(|(index, message, id)| {
            let hash = id.to_string();
            let short_hash = hash.get(..7).unwrap_or(&hash).to_string();
            let date = repo
                .find_commit(id)
                .ok()
                .map(|c| c.time().seconds())
                .unwrap_or(0);
            StashInfo {
                index,
                hash,
                short_hash,
                message,
                date,
            }
        })
        .collect();

    Ok(entries)
}

/// Save current working-tree + staged changes as a new stash entry using the
/// system `git` CLI. We use the CLI (not libgit2) because libgit2's
/// `repo.stash_save` does not support the `--include-untracked` flag reliably
/// across platforms and the system git behaviour is what users expect.
pub fn stash_save(
    repo: &Repository,
    message: Option<&str>,
    include_untracked: bool,
    keep_index: bool,
) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        args.push("--include-untracked".to_string());
    }
    if keep_index {
        args.push("--keep-index".to_string());
    }
    if let Some(msg) = message {
        if !msg.trim().is_empty() {
            args.push("-m".to_string());
            args.push(msg.to_string());
        }
    }

    run_git(workdir, &args, "保存 stash 失败")
}

/// Apply a stash entry by index. Does not remove the stash from the list.
pub fn stash_apply(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "apply".to_string(), idx_str];
    run_git(workdir, &args, "应用 stash 失败")
}

/// Pop a stash entry by index (apply + drop on success).
pub fn stash_pop(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "pop".to_string(), idx_str];
    run_git(workdir, &args, "弹出 stash 失败")
}

/// Drop a stash entry by index without applying it.
pub fn stash_drop(repo: &Repository, index: usize) -> AppResult<String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let idx_str = index.to_string();
    let args = vec!["stash".to_string(), "drop".to_string(), idx_str];
    run_git(workdir, &args, "删除 stash 失败")
}

/// Apply a stash using libgit2 (used internally when we need fine-grained
/// control over conflict handling). Currently unused — kept for future
/// interactive-conflict-resolution flows.
#[allow(dead_code)]
fn _stash_apply_libgit2(repo: &mut Repository, index: usize) -> AppResult<()> {
    let mut opts = StashApplyOptions::default();
    repo.stash_apply(index, Some(&mut opts))?;
    Ok(())
}

fn run_git(workdir: &std::path::Path, args: &[String], err_prefix: &str) -> AppResult<String> {
    cli::run_checked(workdir, args.iter().cloned(), LOCAL_TIMEOUT, err_prefix)
}

#[cfg(test)]
mod tests {
    use super::{list_stashes, stash_apply, stash_drop, stash_pop, stash_save};
    use crate::git::commit::stage_all;
    use git2::{Repository, Signature};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-stash-{name}-{unique}"));
        fs::create_dir_all(&root).expect("create temp directory");
        let repo = Repository::init(&root).expect("init repo");
        {
            let mut config = repo.config().expect("repo config");
            // CI runner 的全局 autocrlf 会在 CLI 恢复文件时改写行尾，
            // 仓库级关闭以保证断言与恢复内容确定性。
            config
                .set_bool("core.autocrlf", false)
                .expect("set autocrlf");
        }

        fs::write(root.join("tracked.txt"), "base\n").expect("write tracked file");
        stage_all(&repo).expect("stage initial");
        let sig = Signature::now("Test User", "test@example.com").expect("signature");
        let mut index = repo.index().expect("index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("initial commit");
        drop(tree);
        (root, repo)
    }

    #[test]
    fn stash_save_apply_drop_roundtrip() {
        let (root, mut repo) = temp_repo("roundtrip");
        fs::write(root.join("tracked.txt"), "changed\n").expect("modify file");
        stash_save(&repo, Some("wip change"), false, false).expect("stash save");

        // Stashing restores the worktree to HEAD.
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("worktree restored"),
            "base\n"
        );

        let stashes = list_stashes(&mut repo).expect("list stashes");
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("wip change"));

        stash_apply(&repo, 0).expect("stash apply");
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("applied"),
            "changed\n"
        );
        // Applying keeps the entry; dropping removes it.
        assert_eq!(list_stashes(&mut repo).expect("list").len(), 1);
        stash_drop(&repo, 0).expect("stash drop");
        assert!(list_stashes(&mut repo).expect("list").is_empty());
    }

    #[test]
    fn stash_pop_applies_and_removes_the_entry() {
        let (root, mut repo) = temp_repo("pop");
        fs::write(root.join("tracked.txt"), "popped\n").expect("modify file");
        stash_save(&repo, None, false, false).expect("stash save");

        stash_pop(&repo, 0).expect("stash pop");
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt")).expect("popped"),
            "popped\n"
        );
        assert!(list_stashes(&mut repo).expect("list").is_empty());
    }

    #[test]
    fn stash_save_includes_untracked_files_when_requested() {
        let (root, repo) = temp_repo("untracked");
        fs::write(root.join("new.txt"), "new file\n").expect("untracked file");

        stash_save(&repo, Some("with untracked"), true, false).expect("stash save");
        assert!(
            !root.join("new.txt").exists(),
            "untracked file must be stashed away"
        );

        stash_pop(&repo, 0).expect("stash pop");
        assert_eq!(
            fs::read_to_string(root.join("new.txt")).expect("untracked restored"),
            "new file\n"
        );
    }
}
