use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::branch::extract_message_body;
use super::cli::{self, LOCAL_TIMEOUT};
use super::merge::{operation_result, run_git_simple};
use super::{BlameLine, LogEntry, MergeResult, ReflogEntry};

/// One step of a linear history-rewrite plan, oldest commit first.
/// `squash` folds the replayed change into the previous step and appends its
/// message. Missing commits are dropped; the original range is explicit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteStep {
    pub hash: String,
    pub message: String,
    #[serde(default)]
    pub squash: bool,
}

/// Rewrite the linear tail of the current branch (reword / drop / squash).
/// `steps` lists kept commits oldest first. `start_hash` includes the original
/// first commit even when it is dropped. `expected_head` rejects stale plans.
///
/// Safety: refuses on detached HEAD or a dirty worktree, validates that every
/// step is reachable from HEAD and that consecutive steps form a linear chain.
/// The moved branch ref gets a reflog entry, so the old history stays
/// recoverable through the reflog recovery panel.
pub fn rewrite_history(
    repo: &Repository,
    start_hash: &str,
    expected_head: &str,
    steps: &[RewriteStep],
) -> AppResult<String> {
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
    if repo.state() != git2::RepositoryState::Clean {
        return Err(AppError::General("请先完成或中止当前 Git 操作".into()));
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
    if head_oid.to_string() != expected_head {
        return Err(AppError::General(
            "分支已有新提交，请关闭整理窗口后重试".into(),
        ));
    }
    let start_oid =
        git2::Oid::from_str(start_hash).map_err(|_| AppError::General("非法的整理起点".into()))?;
    let mut tail = Vec::new();
    let mut cursor = repo.find_commit(head_oid)?;
    let base = loop {
        if tail.len() >= 500 {
            return Err(AppError::General("整理范围过大（上限 500）".into()));
        }
        if cursor.parent_count() > 1 {
            return Err(AppError::General(
                "整理范围包含合并提交，暂不支持改写".into(),
            ));
        }
        tail.push(cursor.id());
        if cursor.id() == start_oid {
            break cursor.parent_ids().next();
        }
        if cursor.parent_count() == 0 {
            return Err(AppError::General("整理起点不在当前分支的线性历史上".into()));
        }
        cursor = cursor.parent(0)?;
    };
    tail.reverse();

    // Only keep ordered members of the captured, linear range. In particular,
    // do not infer the base from the first kept step: it may follow a drop.
    let mut commits: Vec<git2::Commit<'_>> = Vec::with_capacity(steps.len());
    let mut next_position = 0;
    for (i, step) in steps.iter().enumerate() {
        let oid = git2::Oid::from_str(step.hash.trim())
            .map_err(|_| AppError::General(format!("非法提交哈希：{}", step.hash)))?;
        if !step.squash && step.message.trim().is_empty() {
            return Err(AppError::General(format!("第 {} 步的提交信息为空", i + 1)));
        }
        let commit = repo.find_commit(oid)?;
        let position = tail[next_position..]
            .iter()
            .position(|candidate| *candidate == oid)
            .ok_or_else(|| {
                AppError::General("所选提交必须属于整理范围并保持原有先后顺序".into())
            })?;
        next_position += position + 1;
        commits.push(commit);
    }
    if steps[0].squash {
        return Err(AppError::General("第一步不能是合并（squash）".into()));
    }

    // Replay each retained delta with libgit2's three-way tree merge. Copying
    // later snapshots would silently restore changes from dropped commits.
    // Trees/indexes in this pass are in memory; conflicts leave HEAD, the
    // on-disk index, and the worktree untouched.
    let empty_tree_id = repo.treebuilder(None)?.write()?;
    let empty_tree = repo.find_tree(empty_tree_id)?;
    let mut replayed_tree = match base {
        Some(oid) => repo.find_commit(oid)?.tree()?,
        None => repo.find_tree(empty_tree_id)?,
    };
    let mut plan: Vec<(
        git2::Oid,
        String,
        git2::Signature<'static>,
        git2::Signature<'static>,
    )> = Vec::new();
    for (step, commit) in steps.iter().zip(commits.iter()) {
        let original_parent_tree = if commit.parent_count() == 0 {
            None
        } else {
            Some(commit.parent(0)?.tree()?)
        };
        let original_tree = commit.tree()?;
        let mut replayed_index = repo.merge_trees(
            original_parent_tree.as_ref().unwrap_or(&empty_tree),
            &replayed_tree,
            &original_tree,
            None,
        )?;
        if replayed_index.has_conflicts() {
            return Err(AppError::General(format!(
                "丢弃提交后，重放 {} 产生冲突；未修改分支或工作区，请调整整理步骤",
                &step.hash[..7]
            )));
        }
        let tree_id = replayed_index.write_tree_to(repo)?;
        replayed_tree = repo.find_tree(tree_id)?;
        if step.squash {
            match plan.last_mut() {
                Some(entry) => {
                    entry.1.push_str("\n\n");
                    entry.1.push_str(step.message.trim());
                    entry.0 = tree_id;
                }
                None => return Err(AppError::General("第一步不能是合并（squash）".into())),
            }
        } else {
            plan.push((
                tree_id,
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
        let id = repo.commit(None, author, committer, message, &tree, &parents)?;
        parent = Some(id);
        new_head = Some(id);
    }

    let new_head = new_head.ok_or_else(|| AppError::General("整理结果为空".into()))?;
    if repo.head()?.target() != Some(head_oid)
        || super::branch::has_uncommitted_changes(repo)?
        || repo.state() != git2::RepositoryState::Clean
    {
        return Err(AppError::General(
            "仓库状态已变化，未应用整理结果，请重新打开整理窗口".into(),
        ));
    }
    // Git's keep mode also refuses untracked path collisions rather than
    // deleting a file that was created while the dialog was open.
    run_git_simple(
        repo,
        ["reset", "--keep", &new_head.to_string()],
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

/// Attribute the actual worktree content; modified lines have a zero OID.
pub fn get_file_blame(repo: &Repository, file_path: &str) -> AppResult<Vec<BlameLine>> {
    let committed = repo.blame_file(std::path::Path::new(file_path), None)?;
    let content = super::tree::read_worktree_file(repo, file_path)?;
    if content.is_binary || content.truncated {
        return Ok(Vec::new());
    }
    let blame = committed.blame_buffer(content.content.as_bytes())?;
    let mut cache: std::collections::HashMap<git2::Oid, (String, String, i64, String)> =
        std::collections::HashMap::new();
    let mut lines = Vec::new();

    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (hash, author, timestamp, summary) = if oid.is_zero() {
            (oid.to_string(), String::new(), 0, String::new())
        } else {
            match cache.get(&oid) {
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
        index.write().expect("persist staged file");
    }

    #[test]
    fn rewrite_drop_removes_the_dropped_change_from_later_trees() {
        let (root, repo) = temp_repo("drop-content");
        stage_file(&repo, &root, "base.txt", "base\n");
        let first = commit_index(&repo, "base");
        stage_file(&repo, &root, "drop.txt", "drop this change\n");
        commit_index(&repo, "dropped change");
        stage_file(&repo, &root, "keep.txt", "keep this change\n");
        let last = commit_index(&repo, "kept change");

        rewrite_history(
            &repo,
            &first.to_string(),
            &last.to_string(),
            &[
                RewriteStep {
                    hash: first.to_string(),
                    message: "base".into(),
                    squash: false,
                },
                RewriteStep {
                    hash: last.to_string(),
                    message: "kept change".into(),
                    squash: false,
                },
            ],
        )
        .unwrap();

        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(tree.get_name("drop.txt").is_none());
        assert!(!root.join("drop.txt").exists());
        assert_eq!(
            fs::read_to_string(root.join("keep.txt")).unwrap(),
            "keep this change\n"
        );
        assert_eq!(
            repo.head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .parent_id(0)
                .unwrap(),
            first
        );
        assert!(!super::super::branch::has_uncommitted_changes(&repo).unwrap());
        drop(tree);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    fn keep_step(hash: git2::Oid, message: &str, squash: bool) -> RewriteStep {
        RewriteStep {
            hash: hash.to_string(),
            message: message.into(),
            squash,
        }
    }

    #[test]
    fn rewrite_drops_first_selected_commit_without_retaining_it_as_base() {
        let (root, repo) = temp_repo("drop-first");
        stage_file(&repo, &root, "base.txt", "base\n");
        let base = commit_index(&repo, "base");
        stage_file(&repo, &root, "drop.txt", "drop\n");
        let dropped = commit_index(&repo, "drop first selected");
        stage_file(&repo, &root, "keep.txt", "keep\n");
        let head = commit_index(&repo, "keep");

        rewrite_history(
            &repo,
            &dropped.to_string(),
            &head.to_string(),
            &[keep_step(head, "kept", false)],
        )
        .unwrap();
        let rewritten = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(rewritten.parent_id(0).unwrap(), base);
        assert!(!root.join("drop.txt").exists());
        assert!(root.join("base.txt").exists());
        assert!(root.join("keep.txt").exists());
        drop(rewritten);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rewrite_can_drop_original_root_and_replay_onto_an_empty_tree() {
        let (root, repo) = temp_repo("drop-root");
        stage_file(&repo, &root, "drop.txt", "root content\n");
        let first = commit_index(&repo, "root");
        stage_file(&repo, &root, "keep.txt", "retained\n");
        let head = commit_index(&repo, "keep");
        rewrite_history(
            &repo,
            &first.to_string(),
            &head.to_string(),
            &[keep_step(head, "new root", false)],
        )
        .unwrap();
        let rewritten = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(rewritten.parent_count(), 0);
        assert!(!root.join("drop.txt").exists());
        assert_eq!(
            fs::read_to_string(root.join("keep.txt")).unwrap(),
            "retained\n"
        );
        drop(rewritten);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rewrite_conflicting_replay_and_stale_plan_preserve_repository_state() {
        let (root, repo) = temp_repo("drop-conflict");
        stage_file(&repo, &root, "shared.txt", "base\n");
        let base = commit_index(&repo, "base");
        stage_file(&repo, &root, "shared.txt", "dropped\n");
        let first = commit_index(&repo, "drop");
        stage_file(&repo, &root, "shared.txt", "retained but dependent\n");
        let head = commit_index(&repo, "keep");
        let before_index = fs::read(repo.path().join("index")).unwrap();
        let steps = [keep_step(head, "kept", false)];
        let error =
            rewrite_history(&repo, &first.to_string(), &head.to_string(), &steps).unwrap_err();
        assert!(error.to_string().contains("冲突"));
        assert!(rewrite_history(&repo, &first.to_string(), &base.to_string(), &steps).is_err());
        assert_eq!(repo.head().unwrap().target(), Some(head));
        assert_eq!(fs::read(repo.path().join("index")).unwrap(), before_index);
        assert_eq!(
            fs::read_to_string(root.join("shared.txt")).unwrap(),
            "retained but dependent\n"
        );
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rewrite_preserves_author_committer_and_squashes_replayed_changes() {
        let (root, repo) = temp_repo("squash-identities");
        stage_file(&repo, &root, "base.txt", "base\n");
        let base = commit_index(&repo, "base");
        stage_file(&repo, &root, "first.txt", "one\n");
        let tree_oid = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let author = Signature::now("Original author", "author@example.invalid").unwrap();
        let committer = Signature::now("Original committer", "committer@example.invalid").unwrap();
        let parent = repo.find_commit(base).unwrap();
        let first = repo
            .commit(
                Some("HEAD"),
                &author,
                &committer,
                "first",
                &tree,
                &[&parent],
            )
            .unwrap();
        stage_file(&repo, &root, "drop.txt", "drop\n");
        commit_index(&repo, "drop");
        stage_file(&repo, &root, "last.txt", "last\n");
        let head = commit_index(&repo, "last");
        rewrite_history(
            &repo,
            &first.to_string(),
            &head.to_string(),
            &[
                keep_step(first, "reworded", false),
                keep_step(head, "squashed", true),
            ],
        )
        .unwrap();
        let rewritten = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(rewritten.parent_id(0).unwrap(), base);
        assert_eq!(rewritten.message(), Some("reworded\n\nsquashed"));
        assert_eq!(rewritten.author().email(), Some("author@example.invalid"));
        assert_eq!(
            rewritten.committer().email(),
            Some("committer@example.invalid")
        );
        assert!(!root.join("drop.txt").exists());
        assert!(root.join("first.txt").exists());
        assert!(root.join("last.txt").exists());
        drop(rewritten);
        drop(parent);
        drop(tree);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rewrite_rejects_untracked_collision_without_deleting_the_file() {
        let (root, repo) = temp_repo("untracked-collision");
        stage_file(&repo, &root, "base.txt", "base\n");
        commit_index(&repo, "base");
        stage_file(&repo, &root, "restored.txt", "original\n");
        let first = commit_index(&repo, "add restored");
        fs::remove_file(root.join("restored.txt")).unwrap();
        // Persist this prepared fixture's staged deletion.
        let mut index = repo.index().unwrap();
        index
            .remove_path(std::path::Path::new("restored.txt"))
            .unwrap();
        index.write().unwrap();
        commit_index(&repo, "delete restored");
        stage_file(&repo, &root, "keep.txt", "keep\n");
        let head = commit_index(&repo, "keep");
        fs::write(root.join("restored.txt"), "untracked sentinel\n").unwrap();
        let result = rewrite_history(
            &repo,
            &first.to_string(),
            &head.to_string(),
            &[
                keep_step(first, "add restored", false),
                keep_step(head, "keep", false),
            ],
        );
        assert!(result.is_err());
        assert_eq!(repo.head().unwrap().target(), Some(head));
        assert_eq!(
            fs::read_to_string(root.join("restored.txt")).unwrap(),
            "untracked sentinel\n"
        );
        drop(repo);
        fs::remove_dir_all(root).unwrap();
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

    #[test]
    fn blame_marks_modified_and_inserted_worktree_lines_uncommitted() {
        let (root, repo) = temp_repo("worktree-blame");
        stage_file(&repo, &root, "a.txt", "first\nsecond\nthird\n");
        let original = commit_index(&repo, "original lines");
        fs::write(root.join("a.txt"), "first\nchanged\nthird\nadded\n").unwrap();

        let blame = get_file_blame(&repo, "a.txt").unwrap();
        assert_eq!(blame.len(), 4);
        assert_eq!(blame[0].commit_hash, original.to_string());
        assert_eq!(blame[2].commit_hash, original.to_string());
        for line in [&blame[1], &blame[3]] {
            assert_eq!(line.commit_hash, git2::Oid::zero().to_string());
            assert!(line.author.is_empty());
            assert_eq!(line.timestamp, 0);
        }

        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }
}
