use std::collections::HashSet;
use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::{AppError, AppResult};

/// Appends ignore rules to the repository's root `.gitignore`.
///
/// - A missing `.gitignore` is created.
/// - Rules already present (exact match after trimming) are skipped, so
///   repeated invocations are idempotent.
/// - Returns the rules that were actually added, in request order, so the
///   UI can tell "already ignored" apart from "newly ignored".
pub fn add_gitignore_entries(repo: &Repository, entries: &[String]) -> AppResult<Vec<String>> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    append_entries(&workdir.join(".gitignore"), entries)
}

fn append_entries(file: &Path, entries: &[String]) -> AppResult<Vec<String>> {
    // One rule per line: reject control characters outright so a malformed
    // path can never smuggle extra lines into .gitignore, and drop empties.
    let mut wanted: Vec<String> = Vec::new();
    for entry in entries {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains('\r') || trimmed.contains('\n') || trimmed.contains('\0') {
            return Err(AppError::General(format!(
                "Invalid ignore pattern (control characters): {trimmed}"
            )));
        }
        if !wanted.iter().any(|e| e == trimmed) {
            wanted.push(trimmed.to_string());
        }
    }

    let existing = match std::fs::read(file) {
        // Lossy decode: a stray non-UTF8 byte must not block editing the file.
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };

    let known: HashSet<String> = existing.lines().map(|l| l.trim().to_string()).collect();
    let added: Vec<String> = wanted
        .into_iter()
        .filter(|e| !known.contains(e))
        .collect();
    if added.is_empty() {
        return Ok(added);
    }

    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    for entry in &added {
        content.push_str(entry);
        content.push('\n');
    }
    std::fs::write(file, content)?;
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "aigit-ignore-{}-{}",
                tag,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_missing_gitignore() {
        let dir = TempDir::new("create");
        let file = dir.0.join(".gitignore");
        let added = append_entries(&file, &["/build/".to_string()]).unwrap();
        assert_eq!(added, vec!["/build/"]);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "/build/\n");
    }

    #[test]
    fn appends_without_duplicating_existing_rules() {
        let dir = TempDir::new("dedup");
        let file = dir.0.join(".gitignore");
        std::fs::write(&file, "/target/\nnode_modules/\n").unwrap();

        let added =
            append_entries(&file, &["node_modules/".to_string(), "/dist/".to_string()]).unwrap();
        assert_eq!(added, vec!["/dist/"]);

        let content = std::fs::read_to_string(&file).unwrap();
        assert_eq!(content, "/target/\nnode_modules/\n/dist/\n");
    }

    #[test]
    fn repairs_missing_trailing_newline_before_appending() {
        let dir = TempDir::new("newline");
        let file = dir.0.join(".gitignore");
        std::fs::write(&file, "*.log").unwrap();

        append_entries(&file, &["/out/".to_string()]).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "*.log\n/out/\n");
    }

    #[test]
    fn returns_empty_when_every_rule_already_present() {
        let dir = TempDir::new("noop");
        let file = dir.0.join(".gitignore");
        std::fs::write(&file, "/build/\n").unwrap();

        let before = std::fs::metadata(&file).unwrap().len();
        let added = append_entries(&file, &[" /build/ ".to_string()]).unwrap();
        assert!(added.is_empty());
        assert_eq!(std::fs::metadata(&file).unwrap().len(), before);
    }

    #[test]
    fn rejects_control_characters_instead_of_writing_them() {
        let dir = TempDir::new("inject");
        let file = dir.0.join(".gitignore");
        let err = append_entries(&file, &["/a\n/secret".to_string()]).unwrap_err();
        assert!(err.to_string().contains("control characters"));
        assert!(!file.exists(), "nothing must be written on invalid input");
    }
}
