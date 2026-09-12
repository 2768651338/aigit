use std::collections::BTreeMap;
use std::fs;
use std::io::Read;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::cli;
use super::{FileContent, FileTreeEntry};

/// Hard cap per directory listing. A pathological tree (e.g. `node_modules`
/// at the root) must not flood the IPC channel; the listing degrades with a
/// visible `truncated` flag instead of erroring.
const MAX_TREE_ENTRIES: usize = 2000;

/// Cap for the worktree file preview; larger files are cut short and the
/// frontend shows a notice instead of freezing on a multi-megabyte read.
const MAX_FILE_CONTENT_BYTES: usize = 512 * 1024;

/// List one directory of the tracked (index) tree for the file browser.
///
/// `dir` is a repo-root-relative directory path (`None`/`""` = root).
/// Directories come first, then files, both sorted case-insensitively.
pub fn list_tree(repo: &Repository, dir: Option<&str>) -> AppResult<Vec<FileTreeEntry>> {
    list_tree_limited(repo, dir, MAX_TREE_ENTRIES)
}

fn list_tree_limited(
    repo: &Repository,
    dir: Option<&str>,
    max_entries: usize,
) -> AppResult<Vec<FileTreeEntry>> {
    let prefix = match dir {
        None | Some("") => String::new(),
        Some(d) => {
            let trimmed = d.trim_matches('/');
            if trimmed.is_empty() {
                String::new()
            } else {
                format!("{trimmed}/")
            }
        }
    };

    // BTreeMap keyed by lowercase name gives case-insensitive ordering while
    // keeping the original name for display.
    let mut dirs: BTreeMap<String, String> = BTreeMap::new();
    let mut files: BTreeMap<String, String> = BTreeMap::new();
    let mut truncated = false;

    let index = repo.index()?;
    for entry in index.iter() {
        let path = match String::from_utf8(entry.path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let rest = match path.strip_prefix(&prefix) {
            Some(r) if !r.is_empty() => r,
            _ => continue,
        };
        if dirs.len() + files.len() >= max_entries {
            truncated = true;
            break;
        }
        match rest.split_once('/') {
            Some((head, _)) => {
                dirs.insert(head.to_lowercase(), head.to_string());
            }
            None => {
                files.insert(rest.to_lowercase(), rest.to_string());
            }
        }
    }

    let entries = dirs
        .into_values()
        .map(|name| {
            let mut path = prefix.clone();
            path.push_str(&name);
            FileTreeEntry {
                name,
                path,
                kind: "dir".to_string(),
                truncated: false,
            }
        })
        .chain(files.into_values().map(|name| FileTreeEntry {
            path: format!("{prefix}{name}"),
            name,
            kind: "file".to_string(),
            truncated: false,
        }))
        .map(|mut e| {
            if truncated {
                e.truncated = true;
            }
            e
        })
        .collect();

    Ok(entries)
}

/// Read a worktree file for preview: binary-detected, size-capped, lossy
/// UTF-8. Rejects absolute paths and parent traversal so the browser can
/// never be turned into an arbitrary file reader.
pub fn read_worktree_file(repo: &Repository, file_path: &str) -> AppResult<FileContent> {
    validate_relative_path(file_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("裸仓库没有工作区文件".into()))?;
    let full = workdir.join(file_path);

    let meta = fs::metadata(&full).map_err(|e| AppError::General(format!("读取文件失败：{e}")))?;
    if meta.is_dir() {
        return Err(AppError::General("目标不是文件".into()));
    }
    let size = meta.len();
    let cap = (size as usize).min(MAX_FILE_CONTENT_BYTES);

    let file =
        fs::File::open(&full).map_err(|e| AppError::General(format!("读取文件失败：{e}")))?;
    let mut buf = Vec::with_capacity(cap);
    file.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|e| AppError::General(format!("读取文件失败：{e}")))?;

    // NUL-byte sniff over the head of the buffer, same heuristic git uses.
    let sniff_len = buf.len().min(8192);
    let is_binary = buf[..sniff_len].contains(&0);

    Ok(FileContent {
        content: if is_binary {
            String::new()
        } else {
            String::from_utf8_lossy(&buf).into_owned()
        },
        is_binary,
        truncated: size as usize > cap,
        size_bytes: size,
    })
}

/// Reject anything that is not a plain repo-relative path: absolute paths,
/// Windows drive prefixes, and any `..` component.
fn validate_relative_path(file_path: &str) -> AppResult<()> {
    if file_path.is_empty() {
        return Err(AppError::General("文件路径不能为空".into()));
    }
    let p = std::path::Path::new(file_path);
    if p.is_absolute() || file_path.starts_with('/') || file_path.starts_with('\\') {
        return Err(AppError::General("文件路径必须是仓库内相对路径".into()));
    }
    if file_path.contains(':') {
        return Err(AppError::General("文件路径必须是仓库内相对路径".into()));
    }
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::General("文件路径不允许包含 '..'".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("aigit-tree-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("create temp dir");
        let repo = Repository::init(&root).expect("init repo");
        (root, repo)
    }

    fn commit_all(repo: &Repository, msg: &str) -> git2::Oid {
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .expect("add all");
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

    #[test]
    fn lists_dirs_first_then_files() {
        let (root, repo) = temp_repo("layout");
        fs::create_dir_all(root.join("src/inner")).expect("mkdir");
        fs::write(root.join("src/a.rs"), "a\n").expect("write");
        fs::write(root.join("src/inner/b.rs"), "b\n").expect("write");
        fs::write(root.join("README.md"), "r\n").expect("write");
        commit_all(&repo, "init");

        let root_entries = list_tree(&repo, None).expect("root tree");
        let names: Vec<&str> = root_entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["src", "README.md"]);
        assert_eq!(root_entries[0].kind, "dir");
        assert_eq!(root_entries[0].path, "src");

        let src_entries = list_tree(&repo, Some("src")).expect("src tree");
        let names: Vec<&str> = src_entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["inner", "a.rs"]);

        let deep = list_tree(&repo, Some("/src/inner/")).expect("deep tree");
        assert_eq!(deep.len(), 1);
        assert_eq!(deep[0].path, "src/inner/b.rs");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn truncates_when_over_limit() {
        let (root, repo) = temp_repo("truncate");
        for i in 0..8 {
            fs::write(root.join(format!("f{i}.txt")), "x\n").expect("write");
        }
        commit_all(&repo, "init");

        let entries = list_tree_limited(&repo, None, 3).expect("tree");
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| e.truncated));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn file_preview_detects_binary_and_truncates() {
        let (root, repo) = temp_repo("content");
        fs::write(root.join("text.txt"), "hello\nworld\n").expect("write");
        fs::write(root.join("blob.bin"), [0u8, 1, 2, 3]).expect("write");
        fs::write(
            root.join("big.txt"),
            "x".repeat(MAX_FILE_CONTENT_BYTES + 10),
        )
        .expect("write");
        commit_all(&repo, "init");

        let text = read_worktree_file(&repo, "text.txt").expect("text");
        assert!(!text.is_binary);
        assert!(text.content.contains("world"));
        assert!(!text.truncated);

        let bin = read_worktree_file(&repo, "blob.bin").expect("binary");
        assert!(bin.is_binary);
        assert!(bin.content.is_empty());

        let big = read_worktree_file(&repo, "big.txt").expect("big");
        assert!(big.truncated);
        assert_eq!(big.content.len(), MAX_FILE_CONTENT_BYTES);

        assert!(read_worktree_file(&repo, "../outside.txt").is_err());
        assert!(read_worktree_file(&repo, "missing.txt").is_err());

        fs::remove_dir_all(&root).ok();
    }
}
