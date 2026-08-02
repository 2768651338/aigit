use std::fs;
use std::path::{Component, Path, PathBuf};

use git2::{IndexEntry, Repository};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::cli;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitOperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Stash,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitOperationState {
    pub kind: Option<GitOperationKind>,
    pub in_progress: bool,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictKind {
    BothModified,
    BothAdded,
    BothDeleted,
    DeletedByOurs,
    DeletedByTheirs,
    RenameDelete,
    Binary,
    Submodule,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictStage {
    pub path: String,
    pub oid: String,
    pub mode: u32,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub kind: ConflictKind,
    pub base: Option<ConflictStage>,
    pub ours: Option<ConflictStage>,
    pub theirs: Option<ConflictStage>,
    pub worktree_content: Option<String>,
    pub can_edit_text: bool,
    pub fallback_reason: Option<String>,
}

pub fn operation_state(repo: &Repository) -> AppResult<GitOperationState> {
    let gitdir = repo.path();
    let conflicts = list_conflict_details(repo)?
        .into_iter()
        .map(|conflict| conflict.path)
        .collect::<Vec<_>>();
    let kind = if gitdir.join("rebase-merge").exists() || gitdir.join("rebase-apply").exists() {
        Some(GitOperationKind::Rebase)
    } else if gitdir.join("CHERRY_PICK_HEAD").exists() {
        Some(GitOperationKind::CherryPick)
    } else if gitdir.join("REVERT_HEAD").exists() {
        Some(GitOperationKind::Revert)
    } else if gitdir.join("MERGE_HEAD").exists() {
        Some(GitOperationKind::Merge)
    } else if !conflicts.is_empty() {
        // `git stash apply/pop` has no durable operation marker. Unmerged index
        // entries without another sequencer are the safest useful signal.
        Some(GitOperationKind::Stash)
    } else {
        None
    };
    Ok(GitOperationState {
        in_progress: kind.is_some(),
        kind,
        conflicts,
    })
}

pub fn list_conflict_details(repo: &Repository) -> AppResult<Vec<ConflictFile>> {
    let index = repo.index()?;
    let mut result = Vec::new();
    let conflicts = index.conflicts()?;
    for conflict in conflicts {
        let conflict = conflict?;
        let base = conflict
            .ancestor
            .as_ref()
            .map(|entry| read_stage(repo, entry))
            .transpose()?;
        let ours = conflict
            .our
            .as_ref()
            .map(|entry| read_stage(repo, entry))
            .transpose()?;
        let theirs = conflict
            .their
            .as_ref()
            .map(|entry| read_stage(repo, entry))
            .transpose()?;
        let path = preferred_path(&base, &ours, &theirs);
        let paths_differ = stage_paths(&base, &ours, &theirs)
            .windows(2)
            .any(|pair| pair[0] != pair[1]);
        let is_submodule = [&base, &ours, &theirs]
            .into_iter()
            .flatten()
            .any(|stage| stage.mode == 0o160000);
        let is_binary = [&base, &ours, &theirs]
            .into_iter()
            .flatten()
            .any(|stage| stage.content.is_none() && stage.mode != 0o160000);
        let mut kind = classify(base.is_some(), ours.is_some(), theirs.is_some());
        if paths_differ && (ours.is_none() || theirs.is_none()) {
            kind = ConflictKind::RenameDelete;
        }
        if is_binary {
            kind = ConflictKind::Binary;
        }
        if is_submodule {
            kind = ConflictKind::Submodule;
        }
        let can_edit_text = !matches!(
            kind,
            ConflictKind::Binary | ConflictKind::Submodule | ConflictKind::RenameDelete
        );
        let fallback_reason = match kind {
            ConflictKind::Binary => Some("binary".to_string()),
            ConflictKind::Submodule => Some("submodule".to_string()),
            ConflictKind::RenameDelete => Some("rename_delete".to_string()),
            _ => None,
        };
        let worktree_content = if can_edit_text {
            read_worktree_text(repo, &path).ok().flatten()
        } else {
            None
        };
        result.push(ConflictFile {
            path,
            kind,
            base,
            ours,
            theirs,
            worktree_content,
            can_edit_text,
            fallback_reason,
        });
    }
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

pub fn continue_operation(repo: &Repository) -> AppResult<String> {
    match operation_state(repo)?.kind {
        Some(GitOperationKind::Merge) => super::merge::continue_merge(repo),
        Some(GitOperationKind::Rebase) => super::merge::continue_rebase(repo),
        Some(GitOperationKind::CherryPick) => super::merge::run_git_simple(
            repo,
            ["cherry-pick", "--continue"],
            "继续 cherry-pick 失败",
        ),
        Some(GitOperationKind::Revert) => {
            super::merge::run_git_simple(repo, ["revert", "--continue"], "继续 revert 失败")
        }
        Some(GitOperationKind::Stash) => {
            Ok("stash 冲突全部解决后无需 continue；请按需保留或删除 stash".to_string())
        }
        None => Err(AppError::General("当前没有可继续的 Git 操作".to_string())),
    }
}

pub fn skip_operation(repo: &Repository) -> AppResult<String> {
    match operation_state(repo)?.kind {
        Some(GitOperationKind::Rebase) => super::merge::skip_rebase(repo),
        Some(GitOperationKind::CherryPick) => super::merge::run_git_simple(
            repo,
            ["cherry-pick", "--skip"],
            "跳过 cherry-pick 提交失败",
        ),
        Some(GitOperationKind::Revert) => {
            super::merge::run_git_simple(repo, ["revert", "--skip"], "跳过 revert 提交失败")
        }
        Some(GitOperationKind::Merge) => Err(AppError::General(
            "merge 不支持 skip；请解决冲突后 continue，或 abort".to_string(),
        )),
        Some(GitOperationKind::Stash) => Err(AppError::General(
            "stash 冲突没有 sequencer，不能 skip；请逐个保留/删除冲突文件，确认工作区后再手动删除 stash"
                .to_string(),
        )),
        None => Err(AppError::General("当前没有可跳过的 Git 操作".to_string())),
    }
}

pub fn abort_operation(repo: &Repository) -> AppResult<String> {
    match operation_state(repo)?.kind {
        Some(GitOperationKind::Merge) => super::merge::abort_merge(repo),
        Some(GitOperationKind::Rebase) => super::merge::abort_rebase(repo),
        Some(GitOperationKind::CherryPick) => {
            super::merge::run_git_simple(repo, ["cherry-pick", "--abort"], "中止 cherry-pick 失败")
        }
        Some(GitOperationKind::Revert) => {
            super::merge::run_git_simple(repo, ["revert", "--abort"], "中止 revert 失败")
        }
        Some(GitOperationKind::Stash) => Err(AppError::General(
            "stash 冲突没有可安全自动执行的 abort；请使用 ours/theirs 解决或通过 Git 恢复工作区"
                .to_string(),
        )),
        None => Err(AppError::General("当前没有可中止的 Git 操作".to_string())),
    }
}

pub fn save_resolution(repo: &Repository, path: &str, content: &str) -> AppResult<()> {
    let conflict = list_conflict_details(repo)?
        .into_iter()
        .find(|entry| entry.path == path)
        .ok_or_else(|| AppError::General("该路径不是当前索引中的冲突文件".to_string()))?;
    if !conflict.can_edit_text {
        return Err(AppError::General(
            "此冲突类型不能安全地作为文本保存，请使用 ours/theirs 或命令行处理".to_string(),
        ));
    }
    let relative = safe_relative_path(path)?;
    let workdir = cli::workdir(repo)?;
    let destination = workdir.join(&relative);
    let canonical_workdir = workdir.canonicalize()?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::General("冲突文件路径缺少父目录".to_string()))?;
    fs::create_dir_all(parent)?;
    let canonical_parent = parent.canonicalize()?;
    if !canonical_parent.starts_with(&canonical_workdir)
        || fs::symlink_metadata(&destination)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(AppError::General(
            "拒绝通过符号链接写入仓库之外的冲突文件".to_string(),
        ));
    }
    fs::write(&destination, content.as_bytes())?;
    // Update the index through libgit2 so this Repository instance immediately
    // observes that the unmerged stages were replaced by a stage-0 entry.
    let mut index = repo.index()?;
    index.add_path(&relative)?;
    index.write()?;
    Ok(())
}

fn read_stage(repo: &Repository, entry: &IndexEntry) -> AppResult<ConflictStage> {
    let blob = repo.find_blob(entry.id)?;
    let bytes = blob.content();
    let content = if bytes.contains(&0) {
        None
    } else {
        std::str::from_utf8(bytes).ok().map(ToOwned::to_owned)
    };
    Ok(ConflictStage {
        path: String::from_utf8_lossy(&entry.path).into_owned(),
        oid: entry.id.to_string(),
        mode: entry.mode,
        content,
    })
}

fn preferred_path(
    base: &Option<ConflictStage>,
    ours: &Option<ConflictStage>,
    theirs: &Option<ConflictStage>,
) -> String {
    ours.as_ref()
        .or(theirs.as_ref())
        .or(base.as_ref())
        .map(|stage| stage.path.clone())
        .unwrap_or_default()
}

fn stage_paths<'a>(
    base: &'a Option<ConflictStage>,
    ours: &'a Option<ConflictStage>,
    theirs: &'a Option<ConflictStage>,
) -> Vec<&'a str> {
    [base, ours, theirs]
        .into_iter()
        .flatten()
        .map(|stage| stage.path.as_str())
        .collect()
}

fn classify(has_base: bool, has_ours: bool, has_theirs: bool) -> ConflictKind {
    match (has_base, has_ours, has_theirs) {
        (true, true, true) => ConflictKind::BothModified,
        (false, true, true) => ConflictKind::BothAdded,
        (true, false, false) => ConflictKind::BothDeleted,
        (true, false, true) => ConflictKind::DeletedByOurs,
        (true, true, false) => ConflictKind::DeletedByTheirs,
        _ => ConflictKind::Other,
    }
}

fn read_worktree_text(repo: &Repository, path: &str) -> AppResult<Option<String>> {
    let file = cli::workdir(repo)?.join(safe_relative_path(path)?);
    match fs::read(file) {
        Ok(bytes) if !bytes.contains(&0) => Ok(String::from_utf8(bytes).ok()),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn safe_relative_path(path: &str) -> AppResult<PathBuf> {
    cli::validate_pathspec(path, "冲突文件路径")?;
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::General(
            "冲突文件路径必须是仓库内的普通相对路径".to_string(),
        ));
    }
    Ok(candidate.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn git(root: &Path, args: &[&str]) {
        cli::run_checked(
            root,
            args.iter().copied(),
            cli::LOCAL_TIMEOUT,
            "临时仓库 git 命令失败",
        )
        .unwrap();
    }

    #[test]
    fn reads_three_index_stages_and_stages_saved_resolution() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-conflict-{unique}"));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        git(&root, &["config", "user.name", "aigit test"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        fs::write(root.join("story.txt"), "base\n").unwrap();
        git(&root, &["add", "story.txt"]);
        git(&root, &["commit", "-m", "base"]);
        git(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("story.txt"), "theirs\n").unwrap();
        git(&root, &["commit", "-am", "theirs"]);
        git(&root, &["checkout", "master"]);
        fs::write(root.join("story.txt"), "ours\n").unwrap();
        git(&root, &["commit", "-am", "ours"]);
        let output = cli::run(&root, ["merge", "feature"], cli::LOCAL_TIMEOUT).unwrap();
        assert!(!output.success());

        let repo = Repository::open(&root).unwrap();
        let details = list_conflict_details(&repo).unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(
            details[0].base.as_ref().unwrap().content.as_deref(),
            Some("base\n")
        );
        assert_eq!(
            details[0].ours.as_ref().unwrap().content.as_deref(),
            Some("ours\n")
        );
        assert_eq!(
            details[0].theirs.as_ref().unwrap().content.as_deref(),
            Some("theirs\n")
        );
        assert_eq!(
            operation_state(&repo).unwrap().kind,
            Some(GitOperationKind::Merge)
        );

        save_resolution(&repo, "story.txt", "resolved\n").unwrap();
        assert!(list_conflict_details(&repo).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join("story.txt")).unwrap(),
            "resolved\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_paths_outside_worktree() {
        assert!(safe_relative_path("../outside").is_err());
        assert!(safe_relative_path("/absolute").is_err());
        assert!(safe_relative_path("src/main.rs").is_ok());
    }
}
