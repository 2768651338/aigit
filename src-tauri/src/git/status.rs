use git2::{Repository, Status, StatusOptions};

use crate::error::AppResult;

use super::FileStatus;

pub fn get_status(repo: &Repository) -> AppResult<Vec<FileStatus>> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut result = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry.path().unwrap_or("").to_string();

        let old_path = entry
            .head_to_index()
            .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().to_string()));

        // A file can be staged and then modified again in the worktree, in
        // which case it must appear in BOTH lists.
        let index_changed = s
            & (Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE)
            != Status::CURRENT;
        if index_changed {
            result.push(FileStatus {
                path: old_path.clone().unwrap_or_else(|| path.clone()),
                old_path: old_path.clone(),
                status: index_status_str(s, true),
                staged: true,
            });
        }

        let workdir_changed = s
            & (Status::WT_NEW
                | Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_RENAMED
                | Status::WT_TYPECHANGE)
            != Status::CURRENT;
        if workdir_changed {
            let status = if s & Status::WT_NEW != Status::CURRENT {
                "untracked".to_string()
            } else {
                wt_status_str(s, false)
            };
            result.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status,
                staged: false,
            });
        }
    }

    Ok(result)
}

fn index_status_str(s: Status, _staged: bool) -> String {
    if s & Status::INDEX_NEW != Status::CURRENT {
        "added".to_string()
    } else if s & Status::INDEX_MODIFIED != Status::CURRENT {
        "modified".to_string()
    } else if s & Status::INDEX_DELETED != Status::CURRENT {
        "deleted".to_string()
    } else if s & Status::INDEX_RENAMED != Status::CURRENT {
        "renamed".to_string()
    } else if s & Status::INDEX_TYPECHANGE != Status::CURRENT {
        "typechange".to_string()
    } else {
        "modified".to_string()
    }
}

fn wt_status_str(s: Status, _staged: bool) -> String {
    if s & Status::WT_MODIFIED != Status::CURRENT {
        "modified".to_string()
    } else if s & Status::WT_DELETED != Status::CURRENT {
        "deleted".to_string()
    } else if s & Status::WT_RENAMED != Status::CURRENT {
        "renamed".to_string()
    } else if s & Status::WT_TYPECHANGE != Status::CURRENT {
        "typechange".to_string()
    } else {
        "modified".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::get_status;
    use crate::git::commit::stage_all;
    use git2::{Repository, Signature};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-status-{name}-{unique}"));
        fs::create_dir_all(&root).expect("create temp directory");
        let repo = Repository::init(&root).expect("init repo");

        fs::write(root.join("tracked.txt"), "one\n").expect("write tracked file");
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
    fn staged_modified_and_added_files_appear_in_the_staged_list() {
        let (root, repo) = temp_repo("stage-all");
        fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked file");
        fs::write(root.join("newfile.txt"), "hello\n").expect("add untracked file");

        stage_all(&repo).expect("stage all");

        let statuses = get_status(&repo).expect("status");
        let staged: Vec<_> = statuses.iter().filter(|f| f.staged).collect();
        assert_eq!(staged.len(), 2, "both files must be reported as staged");
        assert!(
            staged
                .iter()
                .any(|f| f.path == "tracked.txt" && f.status == "modified"),
            "staged modified file must be listed: {statuses:?}"
        );
        assert!(
            staged
                .iter()
                .any(|f| f.path == "newfile.txt" && f.status == "added"),
            "staged new file must be listed: {statuses:?}"
        );
        assert!(
            statuses.iter().all(|f| f.staged),
            "nothing must remain unstaged after stage-all: {statuses:?}"
        );

        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn untracked_files_stay_in_the_unstaged_list() {
        let (root, repo) = temp_repo("untracked");
        fs::write(root.join("newfile.txt"), "hello\n").expect("add untracked file");

        let statuses = get_status(&repo).expect("status");
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "newfile.txt");
        assert_eq!(statuses[0].status, "untracked");
        assert!(!statuses[0].staged);

        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staged_then_modified_file_appears_in_both_lists() {
        let (root, repo) = temp_repo("both");
        fs::write(root.join("tracked.txt"), "two\n").expect("write staged version");
        stage_all(&repo).expect("stage");
        fs::write(root.join("tracked.txt"), "three\n").expect("modify again in worktree");

        let statuses = get_status(&repo).expect("status");
        assert_eq!(statuses.len(), 2);
        assert!(
            statuses
                .iter()
                .any(|f| f.staged && f.path == "tracked.txt" && f.status == "modified"),
            "staged entry must be listed: {statuses:?}"
        );
        assert!(
            statuses
                .iter()
                .any(|f| !f.staged && f.path == "tracked.txt" && f.status == "modified"),
            "unstaged entry must be listed: {statuses:?}"
        );

        drop(repo);
        let _ = fs::remove_dir_all(root);
    }
}
