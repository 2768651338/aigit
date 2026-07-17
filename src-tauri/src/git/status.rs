use git2::{Repository, Status, StatusOptions};

use crate::error::AppResult;

use super::FileStatus;

pub fn get_status(repo: &Repository) -> AppResult<Vec<FileStatus>> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut result = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry.path().unwrap_or("").to_string();

        let old_path = entry.head_to_index().and_then(|d| {
            d.old_file().path().map(|p| p.to_string_lossy().to_string())
        });

        if s.is_wt_new() || s == Status::WT_NEW {
            result.push(FileStatus {
                path,
                old_path: None,
                status: "untracked".to_string(),
                staged: false,
            });
        } else {
            if s & Status::INDEX_NEW != Status::CURRENT {
                let st = index_status_str(s, true);
                result.push(FileStatus {
                    path: old_path.clone().unwrap_or_else(|| path.clone()),
                    old_path: old_path.clone(),
                    status: st,
                    staged: true,
                });
            }
            if s & Status::WT_MODIFIED != Status::CURRENT
                || s & Status::WT_DELETED != Status::CURRENT
                || s & Status::WT_RENAMED != Status::CURRENT
                || s & Status::WT_TYPECHANGE != Status::CURRENT
            {
                let st = wt_status_str(s, false);
                result.push(FileStatus {
                    path: path.clone(),
                    old_path: None,
                    status: st,
                    staged: false,
                });
            }
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
