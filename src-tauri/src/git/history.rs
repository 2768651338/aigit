use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::branch::extract_message_body;
use super::cli::{self, LOCAL_TIMEOUT};
use super::merge::{operation_result, run_git_simple};
use super::{BlameLine, LogEntry, MergeResult, ReflogEntry};

/// One step of a linear history-rewrite plan, oldest commit first.
/// `squash` folds this commit into the previous step (its tree wins, its
/// message is appended); `reword`/`drop`/reordering are expressed by the
/// caller through the message content and step selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteStep {
    pub hash: String,
    pub message: String,
    #[serde(default)]
    pub squash: bool,
}

/// Rewrite the linear tail of the current branch (reword / drop / squash).
/// `steps` lists the kept commits oldest first; commits between the first
/// kept step and HEAD that are missing from `steps` are dropped.
///
/// Safety: refuses on detached HEAD or a dirty worktree, validates that every
/// step is reachable from HEAD and that consecutive steps form a linear chain.
/// The moved branch ref gets a reflog entry, so the old history stays
/// recoverable through the reflog recovery panel.
pub fn rewrite_history(repo: &Repository, steps: &[RewriteStep]) -> AppResult<String> {
    if steps.is_empty() {
        return Err(AppError::General("没有可应用的整理步骤".into()));
    }
    if steps.len() > 500 {
        return Err(AppError::General("整理步骤过多（上限 500）".into()));
    }
    if repo.head_detached()? {
        return Err(AppError::General(
            "当前处于 detached HEAD，无法整理分支历史".into(),
        ));
    }
    if super::branch::has_uncommitted_changes(repo)? {
        return Err(AppError::UncommittedChanges(
            "rewriting history would discard them".into(),
        ));
    }
    let head_oid = repo
        .head()?
        .target()
        .ok_or_else(|| AppError::General("HEAD 没有指向提交".into()))?;

    // Parse all steps and validate ordering. Kept commits must keep their
    // original relative order (each step a strict descendant of the previous
    // one); gaps are allowed and mean "drop this commit". Reordering is
    // deliberately unsupported: snapshot-tree rewrites cannot re-apply
    // patches in a different order the way `git rebase` does.
    let mut commits: Vec<git2::Commit<'_>> = Vec::with_capacity(steps.len());
    for (i, step) in steps.iter().enumerate() {
        let oid = git2::Oid::from_str(step.hash.trim())
            .map_err(|_| AppError::General(format!("非法提交哈希：{}", step.hash)))?;
        if !step.squash && step.message.trim().is_empty() {
            return Err(AppError::General(format!("第 {} 步的提交信息为空", i + 1)));
        }
        let commit = repo.find_commit(oid)?;
        if i > 0 {
            let prev = commits[i - 1].id();
            if prev == oid || !super::bisect::commit_reachable_from(repo, prev, oid)? {
                return Err(AppError::General(
                    "所选提交必须保持原有先后顺序（不支持调换顺序）".into(),
                ));
            }
        }
        if !super::bisect::commit_reachable_from(repo, oid, head_oid)? {
            return Err(AppError::General(format!(
                "提交 {} 不在当前分支历史上",
                step.hash
            )));
        }
        commits.push(commit);
    }
    if steps[0].squash {
        return Err(AppError::General("第一步不能是合并（squash）".into()));
    }

    // Base = parent of the first kept commit (None when it is the root).
    let base = commits[0].parent(0).ok().map(|c| c.id());

    // Plan pass, oldest first: a squash step folds into the previous kept
    // commit — its tree wins (linear history, later tree is the superset) and
    // its message is appended.
    let mut plan: Vec<(
        git2::Oid,
        String,
        git2::Signature<'static>,
        git2::Signature<'static>,
    )> = Vec::new();
    for (step, commit) in steps.iter().zip(commits.iter()) {
        if step.squash {
            match plan.last_mut() {
                Some(entry) => {
                    entry.1.push_str("\n\n");
                    entry.1.push_str(step.message.trim());
                    entry.0 = commit.tree_id();
                }
                None => return Err(AppError::General("第一步不能是合并（squash）".into())),
            }
        } else {
            plan.push((
                commit.tree_id(),
                step.message.trim().to_string(),
                commit.author().to_owned(),
                commit.committer().to_owned(),
            ));
        }
    }

    // Create the rewritten chain without touching any ref, then move the
    // branch onto it. Original author/committer identities are preserved so
    // only the structure and messages change.
    let mut parent = base;
    let mut new_head = parent;
    for (tree_oid, message, author, committer) in &plan {
        let tree = repo.find_tree(*tree_oid)?;
        let parent_commit = match parent {
            Some(oid) => Some(repo.find_commit(oid)?),
            None => None,
        };
        let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
        let id = repo.commit(None, committer, author, message, &tree, &parents)?;
        parent = Some(id);
        new_head = Some(id);
    }

    let new_head = new_head.ok_or_else(|| AppError::General("整理结果为空".into()))?;
    // Fast-forward the branch + index + worktree to the rewritten chain. The
    // worktree is clean (checked above), so the hard reset only swaps content.
    run_git_simple(
        repo,
        ["reset", "--hard", &new_head.to_string()],
        "整理历史失败",
    )?;
    Ok(new_head.to_string())
}

/// Check out `hash` into the working tree, detaching HEAD (`git checkout <hash>`).
pub fn checkout_commit(repo: &Repository, hash: &str) -> AppResult<String> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_git_simple(repo, ["checkout", "--detach", hash], "迁出提交失败")
}

/// Revert `hash` with a brand-new commit (`git revert <hash> --no-edit`).
pub fn revert_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_sequence_op(repo, "revert", ["revert", "--no-edit", "--", hash])
}

/// Apply `hash` onto the current branch (`git cherry-pick <hash>`).
pub fn cherry_pick_commit(repo: &Repository, hash: &str) -> AppResult<MergeResult> {
    cli::validate_non_option(hash, "提交哈希")?;
    run_sequence_op(repo, "cherry-pick", ["cherry-pick", "--", hash])
}

/// Reset the current branch to `hash` (`git reset --<mode> <hash>`).
pub fn reset_to_commit(repo: &Repository, hash: &str, mode: &str) -> AppResult<String> {
    cli::validate_non_option(hash, "提交哈希")?;
    let mode_arg = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        other => return Err(AppError::General(format!("未知的 reset 模式：{other}"))),
    };
    run_git_simple(repo, ["reset", mode_arg, hash], "重置失败")
}

fn run_sequence_op<I, S>(repo: &Repository, kind: &str, args: I) -> AppResult<MergeResult>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    let workdir = cli::workdir(repo)?;
    let output = cli::run(workdir, args, LOCAL_TIMEOUT)?;
    operation_result(workdir, output, kind)
}

/// Commits that touched `file_path`, newest first (`git log -- <path>`).
///
/// Walks HEAD and keeps commits whose diff against their first parent has a
/// delta under `file_path`. Blame-free history view of a single file.
pub fn get_file_history(
    repo: &Repository,
    file_path: &str,
    limit: usize,
) -> AppResult<Vec<LogEntry>> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(file_path);

    let mut entries = Vec::new();
    for oid in revwalk {
        if entries.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid?)?;
        if !commit_touches_path(repo, &commit, &mut diff_opts)? {
            continue;
        }
        let hash = commit.id().to_string();
        entries.push(LogEntry {
            short_hash: hash[..7].to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            body: extract_message_body(commit.message().unwrap_or("")),
            timestamp: commit.time().seconds(),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            refs: Vec::new(),
            hash,
        });
    }

    Ok(entries)
}

fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    opts: &mut git2::DiffOptions,
) -> AppResult<bool> {
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(opts))?;
    Ok(diff.deltas().count() > 0)
}

/// Per-line blame attribution of `file_path` at HEAD (`git blame`).
///
/// Uncommitted worktree edits are not attributed: lines map to the last
/// commit that touched them, which keeps the result stable while typing.
pub fn get_file_blame(repo: &Repository, file_path: &str) -> AppResult<Vec<BlameLine>> {
    let blame = repo.blame_file(std::path::Path::new(file_path), None)?;
    let mut cache: std::collections::HashMap<git2::Oid, (String, String, i64, String)> =
        std::collections::HashMap::new();
    let mut lines = Vec::new();

    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (hash, author, timestamp, summary) = match cache.get(&oid) {
            Some(hit) => hit.clone(),
            None => {
                let commit = repo.find_commit(oid)?;
                let hit = (
                    oid.to_string(),
                    commit.author().name().unwrap_or("").to_string(),
                    commit.time().seconds(),
                    commit.summary().unwrap_or("").to_string(),
                );
                cache.insert(oid, hit.clone());
                hit
            }
        };
        let short_hash = hash[..7].to_string();
        let start = hunk.final_start_line();
        for i in 0..hunk.lines_in_hunk() {
            lines.push(BlameLine {
                line: (start + i) as u32,
                commit_hash: hash.clone(),
                short_hash: short_hash.clone(),
                author: author.clone(),
                timestamp,
                summary: summary.clone(),
            });
        }
    }

    lines.sort_by_key(|l| l.line);
    Ok(lines)
}

/// Most recent HEAD movements, newest first. The recovery panel uses this to
/// surface commits that a reset/rebase moved away from the current branch.
/// Capped at 200 entries; older history is rarely useful for recovery and
/// this keeps the IPC payload bounded.
pub fn get_head_reflog(repo: &Repository) -> AppResult<Vec<ReflogEntry>> {
    const MAX_REFLOG_ENTRIES: usize = 200;
    let reflog = repo.reflog("HEAD")?;
    let mut entries = Vec::new();
    for entry in reflog.iter() {
        if entries.len() >= MAX_REFLOG_ENTRIES {
            break;
        }
        let new_hash = entry.id_new().to_string();
        let committer = entry.committer();
        entries.push(ReflogEntry {
            old_hash: entry.id_old().to_string(),
            short_hash: new_hash[..7].to_string(),
            new_hash,
            author: committer.name().unwrap_or("").to_string(),
            timestamp: committer.when().seconds(),
            message: entry.message().unwrap_or("").trim().to_string(),
        });
    }
    Ok(entries)
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
        let root = std::env::temp_dir().join(format!(
            "aigit-history-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create temp dir");
        let repo = Repository::init(&root).expect("init repo");
        (root, repo)
    }

    /// Commit the current index as `msg` and return the new HEAD oid.
    fn commit_index(repo: &Repository, msg: &str) -> git2::Oid {
        let mut index = repo.index().expect("index");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = Signature::now("t", "t@example.com").expect("sig");
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        match parent {
            Some(p) => repo
                .commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&p])
                .expect("commit"),
            None => repo
                .commit(Some("HEAD"), &sig, &sig, msg, &tree, &[])
                .expect("commit"),
        }
    }

    fn stage_file(repo: &Repository, root: &std::path::Path, rel: &str, content: &str) {
        fs::write(root.join(rel), content).expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(std::path::Path::new(rel)).expect("add path");
    }

    #[test]
    fn file_history_only_lists_touching_commits() {
        let (root, repo) = temp_repo("filter");
        stage_file(&repo, &root, "a.txt", "one\n");
        let c1 = commit_index(&repo, "add a.txt");
        stage_file(&repo, &root, "b.txt", "bee\n");
        commit_index(&repo, "add b.txt");
        stage_file(&repo, &root, "a.txt", "one\ntwo\n");
        let c3 = commit_index(&repo, "update a.txt");

        let history = get_file_history(&repo, "a.txt", 100).expect("history");
        let hashes: Vec<String> = history.iter().map(|e| e.hash.clone()).collect();
        assert_eq!(hashes, vec![c3.to_string(), c1.to_string()]);
        assert_eq!(history[0].message, "update a.txt");

        let limited = get_file_history(&repo, "a.txt", 1).expect("limited");
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].hash, c3.to_string());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn blame_attributes_lines_to_their_commits() {
        let (root, repo) = temp_repo("blame");
        stage_file(&repo, &root, "a.txt", "first\nsecond\n");
        let c1 = commit_index(&repo, "two lines");
        stage_file(&repo, &root, "a.txt", "first\nsecond\nthird\n");
        let c2 = commit_index(&repo, "add third");

        let blame = get_file_blame(&repo, "a.txt").expect("blame");
        assert_eq!(blame.len(), 3);
        assert_eq!(blame[0].line, 1);
        assert_eq!(blame[0].commit_hash, c1.to_string());
        assert_eq!(blame[2].line, 3);
        assert_eq!(blame[2].commit_hash, c2.to_string());
        assert_eq!(blame[0].author, "t");

        fs::remove_dir_all(&root).ok();
    }
}
