use git2::{BranchType, Repository};

use crate::error::{AppError, AppResult};

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
        let upstream = b
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

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

/// Switch to a local branch. Without `force` the switch is refused when the
/// worktree or index carries uncommitted changes, because the checkout would
/// otherwise discard them — the caller may retry with `force` after the user
/// explicitly confirmed the loss.
pub fn switch_branch(repo: &Repository, name: &str, force: bool) -> AppResult<()> {
    let refname = format!("refs/heads/{name}");
    if !git2::Reference::is_valid_name(&refname) {
        return Err(AppError::General(format!("Invalid branch name: {name}")));
    }
    if !force && has_uncommitted_changes(repo)? {
        return Err(AppError::UncommittedChanges(format!(
            "switching to '{name}' would discard them"
        )));
    }
    repo.set_head(&refname)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    if force {
        checkout.force();
    }
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

/// True when tracked index/worktree state differs from HEAD. Untracked files
/// are deliberately ignored: a safe checkout keeps them, and if one would be
/// overwritten by the target branch the checkout itself fails with a regular
/// git error instead of silently deleting the file.
fn has_uncommitted_changes(repo: &Repository) -> AppResult<bool> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(statuses
        .iter()
        .any(|entry| entry.status() != git2::Status::CURRENT))
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

        let body = extract_message_body(commit.message().unwrap_or(""));

        entries.push(LogEntry {
            hash,
            short_hash,
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            body,
            timestamp: commit.time().seconds(),
            parents,
            refs,
        });
    }

    Ok(entries)
}

/// 从完整提交信息中提取正文：去掉首行（主题）与随后的空行，剩余部分即为正文。
/// 单行信息或仅主题加空行时返回空字符串。
fn extract_message_body(full_message: &str) -> String {
    match full_message.split_once('\n') {
        Some((_, rest)) => rest.trim().to_string(),
        None => String::new(),
    }
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

/// List all tracked files in the repository index, sorted alphabetically.
///
/// Used by the AI chat @file picker so the user can attach any tracked file
/// as context. We read directly from the index (no working-tree scan), which
/// matches `git ls-files` semantics.
pub fn list_files(repo: &Repository) -> AppResult<Vec<String>> {
    let index = repo.index()?;
    let mut files: Vec<String> = index
        .iter()
        .map(|e| e.path)
        .filter_map(|p| String::from_utf8(p).ok())
        .collect();
    files.sort();
    Ok(files)
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

#[cfg(test)]
mod tests {
    use super::extract_message_body;
    use super::switch_branch;
    use crate::git::commit::stage_all;
    use git2::{Repository, Signature};
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-branch-{name}-{unique}"));
        fs::create_dir_all(&root).expect("create temp directory");
        let repo = Repository::init(&root).expect("init repo");

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

    fn create_branch_at_head(repo: &Repository, name: &str) {
        let head = repo.head().expect("head");
        let commit = head.peel_to_commit().expect("head commit");
        repo.branch(name, &commit, false).expect("create branch");
    }

    fn worktree_file(root: &Path) -> String {
        fs::read_to_string(root.join("tracked.txt")).expect("read tracked file")
    }

    #[test]
    fn refuses_to_switch_when_worktree_is_dirty() {
        let (root, repo) = temp_repo("dirty");
        create_branch_at_head(&repo, "other");
        let head_before = repo.head().expect("head").target().expect("head target");
        fs::write(root.join("tracked.txt"), "uncommitted\n").expect("modify file");

        let result = switch_branch(&repo, "other", false);
        assert!(matches!(
            result,
            Err(crate::error::AppError::UncommittedChanges(_))
        ));
        // The failed switch must not have moved HEAD or touched the file.
        assert_eq!(repo.head().expect("head").target(), Some(head_before));
        assert_eq!(worktree_file(&root), "uncommitted\n");
    }

    #[test]
    fn refuses_to_switch_when_changes_are_staged() {
        let (root, repo) = temp_repo("staged");
        create_branch_at_head(&repo, "other");
        fs::write(root.join("tracked.txt"), "staged\n").expect("modify file");
        stage_all(&repo).expect("stage the change");

        let result = switch_branch(&repo, "other", false);
        assert!(matches!(
            result,
            Err(crate::error::AppError::UncommittedChanges(_))
        ));
    }

    #[test]
    fn force_switch_overrides_the_dirty_guard() {
        let (root, repo) = temp_repo("force");
        create_branch_at_head(&repo, "other");
        fs::write(root.join("tracked.txt"), "uncommitted\n").expect("modify file");

        switch_branch(&repo, "other", true).expect("force switch");
        assert_eq!(repo.head().unwrap().shorthand(), Some("other"));
        // Force checkout reset the tracked file to the target branch content.
        assert_eq!(worktree_file(&root), "base\n");
    }

    #[test]
    fn clean_worktree_switches_without_force() {
        let (root, repo) = temp_repo("clean");
        create_branch_at_head(&repo, "other");

        switch_branch(&repo, "other", false).expect("switch on clean worktree");
        assert_eq!(repo.head().unwrap().shorthand(), Some("other"));
    }

    #[test]
    fn untracked_files_do_not_block_the_switch() {
        let (root, repo) = temp_repo("untracked");
        create_branch_at_head(&repo, "other");
        fs::write(root.join("notes.txt"), "keep me\n").expect("untracked file");

        switch_branch(&repo, "other", false).expect("untracked files must not block");
        assert_eq!(repo.head().unwrap().shorthand(), Some("other"));
        assert_eq!(
            fs::read_to_string(root.join("notes.txt")).expect("untracked file survived"),
            "keep me\n"
        );
    }

    #[test]
    fn rejects_invalid_branch_names() {
        let (_root, repo) = temp_repo("invalid-name");
        let result = switch_branch(&repo, "bad..name", false);
        assert!(matches!(result, Err(crate::error::AppError::General(_))));
    }

    #[test]
    fn extracts_body_after_subject_and_blank_line() {
        let full = "feat(sidebar): 支持排序\n\n正文第一段。\n正文第二行。\n";
        assert_eq!(extract_message_body(full), "正文第一段。\n正文第二行。");
    }

    #[test]
    fn returns_empty_for_single_line_message() {
        assert_eq!(extract_message_body("chore(release): 发布 1.0.8"), "");
        assert_eq!(extract_message_body("chore(release): 发布 1.0.8\n"), "");
        assert_eq!(extract_message_body(""), "");
    }

    #[test]
    fn trims_surrounding_whitespace_of_body() {
        let full = "subject\n\r\n  缩进的正文  \n\r\n";
        assert_eq!(extract_message_body(full), "缩进的正文");
    }
}
