use git2::{IndexAddOption, Repository, Signature};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};

fn repository_signature(repo: &Repository) -> AppResult<Signature<'static>> {
    repo.signature()
        .or_else(|_| Signature::now("aigit", "aigit@local"))
        .map_err(AppError::Git)
}

pub fn stage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let mut index = repo.index()?;
    if paths.is_empty() {
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    } else {
        for path in paths {
            index.add_path(std::path::Path::new(path))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn stage_all(repo: &Repository) -> AppResult<()> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let head = repo.head()?;
    let head_commit = head.peel_to_commit()?;
    let head_obj = repo.find_object(head_commit.id(), None)?;

    if paths.is_empty() {
        repo.reset_default(Some(&head_obj), ["*"])?;
    } else {
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        repo.reset_default(Some(&head_obj), &path_refs)?;
    }

    Ok(())
}

pub fn commit(repo: &Repository, message: &str) -> AppResult<String> {
    let sig = repository_signature(repo)?;

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let head = repo.head()?;
    let parent_commit = head.peel_to_commit()?;

    let commit_oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent_commit])?;

    Ok(commit_oid.to_string())
}

pub fn head_is_pushed(repo: &Repository) -> AppResult<bool> {
    let head = repo.head()?;
    let head_oid = head.peel_to_commit()?.id();
    let local_name = head
        .shorthand()
        .ok_or_else(|| AppError::General("Detached HEAD cannot be amended safely".into()))?;
    let branch = repo.find_branch(local_name, git2::BranchType::Local)?;
    let Ok(upstream) = branch.upstream() else {
        return Ok(false);
    };
    let upstream_oid = upstream.get().peel_to_commit()?.id();
    Ok(repo.graph_descendant_of(upstream_oid, head_oid)?)
}

pub fn amend(
    repo: &Repository,
    message: &str,
    include_staged: bool,
    confirm_pushed: bool,
) -> AppResult<String> {
    if head_is_pushed(repo)? && !confirm_pushed {
        return Err(AppError::General(
            "AMEND_PUSHED_CONFIRMATION_REQUIRED".into(),
        ));
    }
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    let sig = repository_signature(repo)?;

    let tree = if include_staged {
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        Some(repo.find_tree(tree_oid)?)
    } else {
        None
    };

    let oid = commit.amend(
        Some("HEAD"),
        Some(&sig),
        Some(&sig),
        None,
        Some(message),
        tree.as_ref(),
    )?;

    Ok(oid.to_string())
}

/// Discard uncommitted changes in the given working-tree files using the
/// system `git checkout -- <paths>`. We use the CLI (not libgit2) because
/// libgit2's checkout API is fiddly to configure correctly for path-limited
/// discards on Windows, and we already depend on the system git for push/pull.
///
/// - Empty `paths` discards ALL working-tree modifications (unstaged + untracked
///   files are NOT removed; only tracked modifications are reverted). Pass
///   specific paths to limit scope.
/// - This is a DESTRUCTIVE operation; callers should confirm with the user.
pub fn discard_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["checkout".to_string(), "--".to_string()];
    if paths.is_empty() {
        args.push(".".to_string());
    } else {
        for p in paths {
            args.push(p.clone());
        }
    }

    for path in paths {
        cli::validate_pathspec(path, "文件路径")?;
    }
    cli::run_checked(workdir, args, LOCAL_TIMEOUT, "丢弃修改失败")?;
    Ok(())
}

struct TempPatch {
    path: PathBuf,
}

impl TempPatch {
    fn create(workdir: &Path, patch: &str) -> AppResult<Self> {
        for _ in 0..8 {
            let path = workdir.join(format!(".aigit-patch-{}.tmp", Uuid::new_v4()));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    file.write_all(patch.as_bytes())
                        .map_err(|e| AppError::General(format!("写入 patch 临时文件失败：{e}")))?;
                    file.flush()
                        .map_err(|e| AppError::General(format!("刷新 patch 临时文件失败：{e}")))?;
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(AppError::General(format!(
                        "创建 patch 临时文件失败：{error}"
                    )))
                }
            }
        }
        Err(AppError::General("无法创建唯一 patch 临时文件".to_string()))
    }

    fn file_name(&self) -> AppResult<String> {
        self.path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned)
            .ok_or_else(|| AppError::General("patch 临时文件名无效".to_string()))
    }
}

impl Drop for TempPatch {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn apply_patch(repo: &Repository, patch: &str, reverse: bool) -> AppResult<()> {
    if patch.is_empty() {
        return Err(AppError::General("patch 不能为空".to_string()));
    }
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let temp_patch = TempPatch::create(workdir, patch)?;
    let mut args = vec![
        "apply".to_string(),
        "--cached".to_string(),
        "--whitespace=nowarn".to_string(),
    ];
    if reverse {
        args.push("--reverse".to_string());
    }
    args.push("--".to_string());
    args.push(temp_patch.file_name()?);

    let output = cli::run(workdir, args, LOCAL_TIMEOUT)?;
    if !output.success() {
        let prefix = if reverse {
            "从暂存区反向应用 patch 失败"
        } else {
            "应用 patch 到暂存区失败"
        };
        return Err(cli::command_failed(prefix, &output));
    }
    Ok(())
}

/// Apply a unified-diff patch to the index (a.k.a. `git apply --cached`).
///
/// Used by the "stage selected lines" feature in the diff viewer: the
/// frontend constructs a patch for the user's selected hunk subset and we
/// apply it directly to the index without touching the working tree.
///
/// `patch` is a UTF-8 unified diff. We write it to a temp file because
/// `git apply` reads from stdin only via `-` (Windows pipes are flaky).
pub fn apply_patch_to_index(repo: &Repository, patch: &str) -> AppResult<()> {
    apply_patch(repo, patch, false)
}

/// Reverse-apply a unified-diff patch to the index (a.k.a. `git apply --cached -R`).
///
/// Used by the "unstage selected lines" feature: the frontend constructs a
/// patch for the user's selected hunk subset of the staged diff and we
/// reverse-apply it to the index.
pub fn apply_patch_to_index_reverse(repo: &Repository, patch: &str) -> AppResult<()> {
    apply_patch(repo, patch, true)
}

#[cfg(test)]
mod tests {
    use super::{amend, stage_all, TempPatch};
    use git2::{Repository, Signature};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn amend_can_keep_or_replace_the_previous_tree() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-amend-test-{unique}"));
        fs::create_dir_all(&root).expect("create temp directory");
        let repo = Repository::init(&root).expect("init repo");

        fs::write(root.join("tracked.txt"), "one\n").expect("write first version");
        stage_all(&repo).expect("stage first version");
        let sig = Signature::now("Test User", "test@example.com").expect("signature");
        let mut index = repo.index().expect("index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("tree");
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .expect("initial commit");
        drop(tree);
        let initial_tree = repo.head().unwrap().peel_to_commit().unwrap().tree_id();

        amend(&repo, "message only", false, false).expect("message-only amend");
        let message_only = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(message_only.message(), Some("message only"));
        assert_eq!(message_only.tree_id(), initial_tree);
        drop(message_only);

        fs::write(root.join("tracked.txt"), "two\n").expect("write second version");
        stage_all(&repo).expect("stage second version");
        amend(&repo, "include staged", true, false).expect("tree amend");
        let tree_amend = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(tree_amend.message(), Some("include staged"));
        assert_ne!(tree_amend.tree_id(), initial_tree);

        drop(tree_amend);
        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn temp_patches_are_unique_and_removed_on_drop() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-patch-test-{unique}"));
        fs::create_dir_all(&root).expect("create temp directory");

        let first = TempPatch::create(&root, "first\n").expect("first patch");
        let second = TempPatch::create(&root, "second\n").expect("second patch");
        let first_path = first.path.clone();
        let second_path = second.path.clone();
        assert_ne!(first_path, second_path);
        assert_eq!(
            fs::read_to_string(&first_path).expect("read patch"),
            "first\n"
        );

        drop(first);
        drop(second);
        assert!(!first_path.exists());
        assert!(!second_path.exists());
        let _ = fs::remove_dir_all(root);
    }
}
