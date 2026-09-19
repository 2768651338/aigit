use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{BranchType, Oid, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::stash;

/// Safety valve for one-shot scans: branch enumeration and index walking stop
/// at this many entries and the report is flagged truncated instead of
/// blocking the panel. Tunable via `health.max_scan_entries` in config.toml.
pub const MAX_SCAN_ENTRIES: usize = 50_000;

/// Per-list cap so one pathological repository cannot flood the IPC payload.
const MAX_LIST_ENTRIES: usize = 200;

#[derive(Debug, Clone, Copy)]
pub struct HealthThresholds {
    pub stale_days: u32,
    pub large_file_min_bytes: u64,
    pub large_file_top_n: usize,
    pub max_scan_entries: usize,
}

/// One branch in a health report list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchHealth {
    pub name: String,
    /// Last commit timestamp (Unix seconds).
    pub last_commit_date: i64,
    pub last_commit_message: String,
    /// Checked out by some worktree (including the current one's exclusions
    /// are handled separately): such branches cannot be deleted before the
    /// worktree is removed, so the UI must not offer deletion.
    pub occupied_by_worktree: bool,
}

/// One oversized tracked file (staged content, from the index).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LargeFileEntry {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashHealth {
    pub count: usize,
    /// Oldest stash timestamp, `None` when the stash list is empty.
    pub oldest_date: Option<i64>,
}

/// Which scans hit their entry budget and stopped early.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HealthTruncation {
    pub branches: bool,
    pub files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoHealth {
    /// Detected integration branch. `None` when neither `origin/HEAD` nor a
    /// local `main`/`master` exists — merged/unmerged sections degrade to a
    /// "cannot determine default branch" notice instead of guessing.
    pub default_branch: Option<String>,
    /// Local branches whose last commit is older than `stale_days`.
    pub stale_branches: Vec<BranchHealth>,
    /// Local branches fully contained in the default branch (deletable).
    pub merged_local_branches: Vec<BranchHealth>,
    /// Remote-tracking branches with commits not merged into the default branch.
    pub unmerged_remote_branches: Vec<BranchHealth>,
    pub large_files: Vec<LargeFileEntry>,
    pub stash: StashHealth,
    pub truncated: HealthTruncation,
}

pub fn collect_health(
    repo: &mut Repository,
    thresholds: &HealthThresholds,
) -> AppResult<RepoHealth> {
    let occupied = worktree_checked_out_branches(repo);
    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(str::to_owned));
    let default_branch = detect_default_branch(repo)?;
    let default_tip = default_branch
        .as_deref()
        .and_then(|name| branch_tip(repo, name));

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let stale_cutoff = now - (thresholds.stale_days as i64) * 86_400;

    let mut stale_branches: Vec<BranchHealth> = Vec::new();
    let mut merged_local_branches: Vec<BranchHealth> = Vec::new();
    let mut unmerged_remote_branches: Vec<BranchHealth> = Vec::new();
    let mut truncated = HealthTruncation::default();
    let mut scanned = 0usize;

    let local_branches = repo.branches(Some(BranchType::Local))?;
    for branch in local_branches {
        scanned += 1;
        if scanned > thresholds.max_scan_entries {
            truncated.branches = true;
            break;
        }
        let (b, _) = branch?;
        let Some(name) = b.name()?.map(str::to_owned) else {
            continue;
        };
        if Some(name.as_str()) == current.as_deref()
            || Some(name.as_str()) == default_branch.as_deref()
        {
            continue;
        }
        let Ok(commit) = b.get().peel_to_commit() else {
            continue;
        };
        let entry = BranchHealth {
            name: name.clone(),
            last_commit_date: commit.time().seconds(),
            last_commit_message: commit.summary().unwrap_or("").to_string(),
            occupied_by_worktree: occupied.contains(&name),
        };
        if entry.last_commit_date < stale_cutoff {
            push_capped_branch(&mut stale_branches, entry.clone(), &mut truncated);
        }
        if let Some(default_tip) = default_tip {
            let tip = commit.id();
            // A branch pointing at the default branch itself is fully merged
            // too (`graph_descendant_of` is strict about equality).
            let is_merged =
                tip == default_tip || repo.graph_descendant_of(default_tip, tip).unwrap_or(false);
            if is_merged {
                push_capped_branch(&mut merged_local_branches, entry, &mut truncated);
            }
        }
    }

    let remote_branches = repo.branches(Some(BranchType::Remote))?;
    for branch in remote_branches {
        scanned += 1;
        if scanned > thresholds.max_scan_entries {
            truncated.branches = true;
            break;
        }
        let (b, _) = branch?;
        let Some(name) = b.name()?.map(str::to_owned) else {
            continue;
        };
        // `origin/HEAD` is a symbolic pointer, not a real branch.
        if name.ends_with("/HEAD") {
            continue;
        }
        let Some(default_branch) = default_branch.as_deref() else {
            continue;
        };
        if name == format!("origin/{default_branch}") {
            continue;
        }
        let Ok(commit) = b.get().peel_to_commit() else {
            continue;
        };
        let Some(default_tip) = default_tip else {
            continue;
        };
        let tip = commit.id();
        if tip != default_tip && !repo.graph_descendant_of(default_tip, tip).unwrap_or(false) {
            push_capped_branch(
                &mut unmerged_remote_branches,
                BranchHealth {
                    name,
                    last_commit_date: commit.time().seconds(),
                    last_commit_message: commit.summary().unwrap_or("").to_string(),
                    occupied_by_worktree: false,
                },
                &mut truncated,
            );
        }
    }

    // Oldest first: the cleanup priority the panel presents.
    stale_branches.sort_by_key(|b| b.last_commit_date);
    merged_local_branches.sort_by_key(|b| b.last_commit_date);
    // Freshest work first: recent unmerged remote branches matter most.
    unmerged_remote_branches.sort_by(|a, b| b.last_commit_date.cmp(&a.last_commit_date));

    let large_files = collect_large_files(repo, thresholds, &mut truncated)?;
    let stashes = stash::list_stashes(repo)?;
    let stash_health = StashHealth {
        count: stashes.len(),
        oldest_date: stashes.iter().map(|s| s.date).filter(|d| *d > 0).min(),
    };

    Ok(RepoHealth {
        default_branch,
        stale_branches,
        merged_local_branches,
        unmerged_remote_branches,
        large_files,
        stash: stash_health,
        truncated,
    })
}

/// Append to a health list unless it already hit the per-list cap, in which
/// case the report is flagged truncated instead of growing unboundedly.
fn push_capped_branch(
    list: &mut Vec<BranchHealth>,
    entry: BranchHealth,
    truncated: &mut HealthTruncation,
) {
    if list.len() < MAX_LIST_ENTRIES {
        list.push(entry);
    } else {
        truncated.branches = true;
    }
}

/// Oversized tracked files from the index. Reads blob sizes straight from the
/// object database — no working-tree stat calls.
fn collect_large_files(
    repo: &Repository,
    thresholds: &HealthThresholds,
    truncated: &mut HealthTruncation,
) -> AppResult<Vec<LargeFileEntry>> {
    let index = repo.index()?;
    let mut files: Vec<LargeFileEntry> = Vec::new();
    for (i, entry) in index.iter().enumerate() {
        if i >= thresholds.max_scan_entries {
            truncated.files = true;
            break;
        }
        let Ok(blob) = repo.find_blob(entry.id) else {
            continue;
        };
        let size = blob.size() as u64;
        if size >= thresholds.large_file_min_bytes {
            files.push(LargeFileEntry {
                path: String::from_utf8_lossy(&entry.path).into_owned(),
                size_bytes: size,
            });
        }
    }
    files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    files.truncate(thresholds.large_file_top_n);
    Ok(files)
}

/// Default branch resolution: `origin/HEAD` symbolic target, then local
/// `main`, then local `master`. `None` means "cannot determine" — callers
/// degrade instead of guessing.
fn detect_default_branch(repo: &Repository) -> AppResult<Option<String>> {
    if let Ok(origin_head) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Some(target) = origin_head.symbolic_target() {
            if let Some(name) = target.strip_prefix("refs/remotes/origin/") {
                if !name.is_empty() && name != "HEAD" {
                    return Ok(Some(name.to_string()));
                }
            }
        }
    }
    for name in ["main", "master"] {
        if repo.find_branch(name, BranchType::Local).is_ok() {
            return Ok(Some(name.to_string()));
        }
    }
    Ok(None)
}

fn branch_tip(repo: &Repository, name: &str) -> Option<Oid> {
    repo.find_reference(&format!("refs/heads/{name}"))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/origin/{name}")))
        .ok()
        .and_then(|r| r.peel_to_commit().ok())
        .map(|c| c.id())
}

/// git2 0.19 does not wrap libgit2's `git_repository_commondir`. Linked
/// worktrees record the path to the shared `.git` directory in a `commondir`
/// file inside their per-worktree git dir; a plain repository has no such
/// file and its git dir *is* the common dir.
fn repository_common_dir(repo: &Repository) -> std::path::PathBuf {
    let git_dir = repo.path();
    if let Ok(content) = std::fs::read_to_string(git_dir.join("commondir")) {
        let joined = git_dir.join(content.trim());
        return joined.canonicalize().unwrap_or(joined);
    }
    git_dir.to_path_buf()
}

/// Branches checked out in any worktree, parsed from the on-disk HEAD files
/// (libgit2's `Worktree` does not expose the checked-out reference). Covers
/// the main worktree, linked worktrees, and a repository opened *from* a
/// linked worktree. Detached worktrees contribute nothing.
fn worktree_checked_out_branches(repo: &Repository) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut add_head = |content: Option<String>| {
        if let Some(content) = content {
            if let Some(branch) = content.trim().strip_prefix("ref: refs/heads/") {
                names.insert(branch.to_string());
            }
        }
    };
    let common_dir = repository_common_dir(repo);
    // Common dir HEAD is the main worktree; repo path HEAD wins when the
    // repository itself was opened from a linked worktree.
    add_head(std::fs::read_to_string(common_dir.join("HEAD")).ok());
    add_head(std::fs::read_to_string(repo.path().join("HEAD")).ok());
    let worktrees_dir = common_dir.join("worktrees");
    if let Ok(entries) = std::fs::read_dir(&worktrees_dir) {
        for entry in entries.flatten() {
            add_head(std::fs::read_to_string(entry.path().join("HEAD")).ok());
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::commit::stage_all;
    use crate::git::worktree::{add_worktree, remove_worktree};
    use git2::{Signature, Time};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-health-{name}-{unique}"));
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
        (root, repo)
    }

    fn now_secs() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_secs() as i64
    }

    /// Commit an (possibly empty) index tree onto `ref_name` with a fixed
    /// timestamp. The ref is created when unborn, so tests fully control the
    /// topology without touching the worktree.
    fn commit_on(repo: &Repository, ref_name: &str, message: &str, time: i64) -> git2::Oid {
        let sig = Signature::new("Test User", "test@example.com", &Time::new(time, 0))
            .expect("signature");
        let mut index = repo.index().expect("index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let parent = repo
            .find_reference(ref_name)
            .ok()
            .and_then(|r| r.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.as_ref().into_iter().collect();
        repo.commit(Some(ref_name), &sig, &sig, message, &tree, &parents)
            .expect("commit")
    }

    fn branch_at(repo: &Repository, name: &str, oid: git2::Oid) {
        let commit = repo.find_commit(oid).expect("commit");
        repo.branch(name, &commit, false).expect("create branch");
    }

    fn remote_branch_at(repo: &Repository, name: &str, oid: git2::Oid) {
        repo.reference(
            &format!("refs/remotes/origin/{name}"),
            oid,
            true,
            "health test",
        )
        .expect("create remote-tracking ref");
    }

    fn thresholds(stale_days: u32, min_mb: u64, top_n: usize, scan: usize) -> HealthThresholds {
        HealthThresholds {
            stale_days,
            large_file_min_bytes: min_mb * 1024 * 1024,
            large_file_top_n: top_n,
            max_scan_entries: scan,
        }
    }

    #[test]
    fn classifies_stale_merged_and_unmerged_branches() {
        let (root, mut repo) = temp_repo("classify");
        let now = now_secs();
        let day = 86_400i64;

        // master: c1(40d) <- c2(39d) <- c3(10d); current + default via fallback.
        let c1 = commit_on(&repo, "refs/heads/master", "c1", now - 40 * day);
        let c2 = commit_on(&repo, "refs/heads/master", "c2", now - 39 * day);
        let c3 = commit_on(&repo, "refs/heads/master", "c3", now - 10 * day);

        // feature-old: points at c2, which master contains -> stale and merged.
        branch_at(&repo, "feature-old", c2);
        // feature-new: points at master tip -> merged by equality, not stale.
        branch_at(&repo, "feature-new", c3);
        // feature-unmerged: fresh commit off c1 -> neither stale nor merged.
        branch_at(&repo, "feature-unmerged", c1);
        let c4 = commit_on(&repo, "refs/heads/feature-unmerged", "c4", now);

        // Remote: one merged tracking branch, one with unmerged work.
        remote_branch_at(&repo, "remote-merged", c2);
        remote_branch_at(&repo, "remote-unmerged", c4);

        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1000)).expect("health");
        assert_eq!(health.default_branch.as_deref(), Some("master"));

        let stale: Vec<&str> = health
            .stale_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        // master is current and default; feature-new and feature-unmerged are fresh.
        assert_eq!(stale, vec!["feature-old"]);

        let merged: Vec<&str> = health
            .merged_local_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert_eq!(merged, vec!["feature-old", "feature-new"]);

        let unmerged: Vec<&str> = health
            .unmerged_remote_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        // origin/remote-merged is contained in master; origin/HEAD absent.
        assert_eq!(unmerged, vec!["origin/remote-unmerged"]);
        assert!(!health.truncated.branches);
        assert!(!health.truncated.files);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stash_backlog_reports_count_and_oldest_entry() {
        let (root, mut repo) = temp_repo("stash");
        let now = now_secs();
        commit_on(&repo, "refs/heads/master", "c1", now);

        fs::write(root.join("wip.txt"), "wip\n").expect("untracked file");
        super::stash::stash_save(&repo, Some("backlog entry"), true, false).expect("stash save");

        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1000)).expect("health");
        assert_eq!(health.stash.count, 1);
        assert!(health.stash.oldest_date.is_some());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn worktree_occupied_branch_is_flagged() {
        let (root, mut repo) = temp_repo("occupied");
        let now = now_secs();
        let c1 = commit_on(&repo, "refs/heads/master", "c1", now);
        branch_at(&repo, "wt-branch", c1);

        let wt_path = root.join("wt-occupied");
        add_worktree(&repo, "occupied-wt", &wt_path, Some("wt-branch")).expect("add worktree");

        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1000)).expect("health");
        let occupied_branch = health
            .merged_local_branches
            .iter()
            .find(|b| b.name == "wt-branch")
            .expect("wt-branch is merged and must be listed");
        assert!(occupied_branch.occupied_by_worktree);
        let fresh = health
            .merged_local_branches
            .iter()
            .all(|b| b.name != "master");
        assert!(fresh);

        remove_worktree(&repo, "occupied-wt", true).expect("cleanup worktree");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn large_files_respect_top_n_and_scan_budget() {
        let (root, mut repo) = temp_repo("files");
        let now = now_secs();
        commit_on(&repo, "refs/heads/master", "c1", now);

        fs::write(root.join("small.txt"), "tiny\n").expect("small file");
        fs::write(root.join("big1.bin"), vec![0u8; 2 * 1024 * 1024]).expect("big1");
        fs::write(root.join("big2.bin"), vec![0u8; 3 * 1024 * 1024]).expect("big2");
        stage_all(&repo).expect("stage files");

        let health = collect_health(&mut repo, &thresholds(30, 1, 1, 1000)).expect("health");
        assert_eq!(health.large_files.len(), 1);
        assert_eq!(health.large_files[0].path, "big2.bin");
        assert!(!health.truncated.files);

        // A tiny scan budget must stop early and flag the truncation.
        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1)).expect("health");
        assert!(health.truncated.files);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn default_branch_falls_back_then_degrades_to_none() {
        // Fallback prefers local main over master.
        let (root, mut repo) = temp_repo("fallback-main");
        let now = now_secs();
        let c1 = commit_on(&repo, "refs/heads/master", "c1", now);
        branch_at(&repo, "main", c1);
        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1000)).expect("health");
        assert_eq!(health.default_branch.as_deref(), Some("main"));
        fs::remove_dir_all(&root).ok();

        // Without main/master/origin/HEAD the merged sections degrade.
        let (root, mut repo) = temp_repo("fallback-none");
        commit_on(&repo, "refs/heads/develop", "c1", now);
        // HEAD must resolve for the "current branch" exclusion to work.
        repo.set_head("refs/heads/develop").expect("set head");
        branch_at(
            &repo,
            "side",
            repo.head().expect("head").target().expect("target"),
        );
        let health = collect_health(&mut repo, &thresholds(30, 1, 20, 1000)).expect("health");
        assert_eq!(health.default_branch, None);
        assert!(health.merged_local_branches.is_empty());
        assert!(health.unmerged_remote_branches.is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
