use git2::{Diff, DiffOptions, Repository};

use crate::error::AppResult;

use super::{DiffHunk, DiffLine, FileDiff};

pub fn get_workdir_diff(repo: &Repository, path: Option<&str>) -> AppResult<Vec<FileDiff>> {
    let mut opts = DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p);
    }

    let head_tree = repo.head()?.peel_to_tree()?;
    let diff = repo.diff_tree_to_workdir_with_index(
        Some(&head_tree),
        Some(&mut opts),
    )?;

    parse_diff(&diff)
}

pub fn get_staged_diff(repo: &Repository, path: Option<&str>) -> AppResult<Vec<FileDiff>> {
    let mut opts = DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p);
    }

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = match head_tree {
        Some(tree) => repo.diff_tree_to_index(Some(&tree), Some(&repo.index()?), Some(&mut opts))?,
        None => repo.diff_tree_to_index(None, Some(&repo.index()?), Some(&mut opts))?,
    };

    parse_diff(&diff)
}

#[allow(dead_code)]
pub fn get_file_diff(
    repo: &Repository,
    path: &str,
    old_ref: Option<&str>,
    new_ref: Option<&str>,
) -> AppResult<Vec<FileDiff>> {
    let mut opts = DiffOptions::new();
    opts.pathspec(path);

    let diff = match (old_ref, new_ref) {
        (Some(old), Some(new)) => {
            let old_tree = ref_to_tree(repo, old)?;
            let new_tree = ref_to_tree(repo, new)?;
            repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut opts))?
        }
        (Some(old), None) => {
            let old_tree = ref_to_tree(repo, old)?;
            repo.diff_tree_to_workdir_with_index(Some(&old_tree), Some(&mut opts))?
        }
        _ => {
            return get_workdir_diff(repo, Some(path));
        }
    };

    parse_diff(&diff)
}

#[allow(dead_code)]
fn ref_to_tree<'a>(repo: &'a Repository, refname: &str) -> AppResult<git2::Tree<'a>> {
    let obj = repo.revparse_single(refname)?;
    Ok(obj.peel_to_tree()?)
}

fn parse_diff(diff: &Diff) -> AppResult<Vec<FileDiff>> {
    let mut files = Vec::new();

    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta.new_file().path().and_then(|p| p.to_str()).unwrap_or("");
        let old_path = delta.old_file().path().and_then(|p| p.to_str()).map(|s| s.to_string());

        let file = files.iter_mut().find(|f: &&mut FileDiff| f.path == path);
        let file = match file {
            Some(f) => f,
            None => {
                files.push(FileDiff {
                    path: path.to_string(),
                    old_path,
                    hunks: Vec::new(),
                    additions: 0,
                    deletions: 0,
                });
                files.last_mut().unwrap()
            }
        };

        let content = String::from_utf8_lossy(line.content()).to_string();
        match line.origin() {
            'H' => {
                file.hunks.push(DiffHunk {
                    header: content.trim_end().to_string(),
                    lines: Vec::new(),
                });
            }
            '+' => {
                if let Some(hunk) = file.hunks.last_mut() {
                    hunk.lines.push(DiffLine {
                        content: content.trim_end().to_string(),
                        line_type: "add".to_string(),
                        old_line_no: None,
                        new_line_no: line.new_lineno(),
                    });
                    file.additions += 1;
                }
            }
            '-' => {
                if let Some(hunk) = file.hunks.last_mut() {
                    hunk.lines.push(DiffLine {
                        content: content.trim_end().to_string(),
                        line_type: "delete".to_string(),
                        old_line_no: line.old_lineno(),
                        new_line_no: None,
                    });
                    file.deletions += 1;
                }
            }
            _ => {
                if let Some(hunk) = file.hunks.last_mut() {
                    hunk.lines.push(DiffLine {
                        content: content.trim_end().to_string(),
                        line_type: "context".to_string(),
                        old_line_no: line.old_lineno(),
                        new_line_no: line.new_lineno(),
                    });
                }
            }
        }
        true
    })?;

    Ok(files)
}
