use std::collections::HashSet;

use git2::{Diff, DiffOptions, Repository, Status, StatusOptions};

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

    let mut files = parse_diff(&diff)?;
    // libgit2 的 `diff_tree_to_workdir_with_index` 不会可靠地包含未跟踪文件
    // （`include_untracked` 对该 API 基本不生效），手动补充，确保 AI 分析
    // 能覆盖工作区里的新建文件。
    append_untracked_files(repo, path, &mut files)?;
    Ok(files)
}

/// 读取工作区中的未跟踪文件并构造"全文新增"形式的 diff，追加到 `files`。
fn append_untracked_files(
    repo: &Repository,
    pathspec: Option<&str>,
    files: &mut Vec<FileDiff>,
) -> AppResult<()> {
    let workdir = match repo.workdir() {
        Some(w) => w,
        None => return Ok(()),
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let existing: HashSet<String> = files.iter().map(|f| f.path.clone()).collect();

    for entry in statuses.iter() {
        let s = entry.status();
        if !(s.is_wt_new() || s == Status::WT_NEW) {
            continue;
        }
        let file_path = match entry.path() {
            Some(p) if !p.is_empty() => p,
            _ => continue,
        };
        if existing.contains(file_path) {
            continue;
        }
        if let Some(p) = pathspec {
            if !pathspec_matches(file_path, p) {
                continue;
            }
        }
        let full_path = workdir.join(file_path);
        // 跳过目录、符号链接等非普通文件；二进制文件读取为 UTF-8 失败时也跳过。
        if !full_path.is_file() {
            continue;
        }
        let content = match std::fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let lines: Vec<&str> = content.lines().collect();
        let count = lines.len() as u32;
        let hunk_lines: Vec<DiffLine> = lines
            .iter()
            .enumerate()
            .map(|(i, line)| DiffLine {
                content: line.to_string(),
                line_type: "add".to_string(),
                old_line_no: None,
                new_line_no: Some((i + 1) as u32),
            })
            .collect();
        files.push(FileDiff {
            path: file_path.to_string(),
            old_path: None,
            hunks: vec![DiffHunk {
                header: format!("@@ -0,0 +1,{} @@", count),
                lines: hunk_lines,
            }],
            additions: count,
            deletions: 0,
        });
    }
    Ok(())
}

/// 简单的 pathspec 匹配：支持完全匹配和目录前缀匹配。
fn pathspec_matches(file_path: &str, pattern: &str) -> bool {
    if pattern.is_empty() {
        return true;
    }
    let pat = pattern.trim_end_matches('/');
    file_path == pat || file_path.starts_with(&format!("{pat}/"))
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
