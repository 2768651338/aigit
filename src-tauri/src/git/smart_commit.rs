use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use git2::Repository;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitSnapshot {
    pub repo_path: String,
    pub head: String,
    pub index_tree: String,
    pub diff_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatchSelectionKind {
    Hunk,
    WholeFileFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchSelection {
    pub id: String,
    pub file_path: String,
    pub old_path: Option<String>,
    pub hunk_header: String,
    pub patch: String,
    pub kind: PatchSelectionKind,
    pub fallback_reason: Option<String>,
    pub snapshot: CommitSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitGroup {
    pub id: String,
    pub reason: String,
    pub message: String,
    pub selections: Vec<PatchSelection>,
    #[serde(default)]
    pub committed_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitPlan {
    pub id: String,
    pub schema_version: u32,
    pub snapshot: CommitSnapshot,
    pub groups: Vec<CommitGroup>,
    pub existing_staged: bool,
    pub fallback: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitPlanDraft {
    pub snapshot: CommitSnapshot,
    pub selections: Vec<PatchSelection>,
    pub existing_staged: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageGroupResult {
    pub group_id: String,
    pub staged_tree: String,
    pub state: String,
    pub recovery: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitGroupResult {
    pub group_id: String,
    pub commit_hash: String,
    pub state: String,
    pub recovery: String,
    pub plan: CommitPlan,
}

pub fn hash_text(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn git_text(repo: &Repository, args: Vec<String>, label: &str) -> AppResult<String> {
    let output = cli::run(cli::workdir(repo)?, args, LOCAL_TIMEOUT)?;
    if !output.success() {
        return Err(cli::command_failed(label, &output));
    }
    Ok(output.stdout_lossy())
}

fn head(repo: &Repository) -> AppResult<String> {
    repo.head()?
        .target()
        .map(|oid| oid.to_string())
        .ok_or_else(|| AppError::General("智能拆分提交需要有效的 HEAD".into()))
}

fn index_tree(repo: &Repository) -> AppResult<String> {
    let mut index = repo.index()?;
    Ok(index.write_tree()?.to_string())
}

fn full_diff(repo: &Repository) -> AppResult<String> {
    git_text(
        repo,
        vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--binary".into(),
            "--find-renames".into(),
            "HEAD".into(),
            "--".into(),
        ],
        "读取智能拆分 diff 失败",
    )
}

fn canonical_repo_path(repo: &Repository) -> AppResult<String> {
    let path = cli::workdir(repo)?.canonicalize()?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

pub fn capture_snapshot(repo: &Repository) -> AppResult<CommitSnapshot> {
    let diff = full_diff(repo)?;
    Ok(CommitSnapshot {
        repo_path: canonical_repo_path(repo)?,
        head: head(repo)?,
        index_tree: index_tree(repo)?,
        diff_hash: hash_text(&diff),
    })
}

fn has_staged_changes(repo: &Repository) -> AppResult<bool> {
    let output = cli::run(
        cli::workdir(repo)?,
        ["diff", "--cached", "--quiet", "--exit-code"],
        LOCAL_TIMEOUT,
    )?;
    Ok(!output.success())
}

fn split_file_patches(diff: &str) -> Vec<String> {
    let mut patches = Vec::new();
    let mut current = String::new();
    for line in diff.split_inclusive('\n') {
        if line.starts_with("diff --git ") && !current.is_empty() {
            patches.push(current);
            current = String::new();
        }
        current.push_str(line);
    }
    if !current.trim().is_empty() {
        patches.push(current);
    }
    patches
}

fn parse_paths(header: &str) -> (String, Option<String>) {
    let first = header.lines().next().unwrap_or_default();
    let rest = first.strip_prefix("diff --git a/").unwrap_or_default();
    if let Some((old, new)) = rest.split_once(" b/") {
        (new.to_string(), (old != new).then(|| old.to_string()))
    } else {
        ("unknown".into(), None)
    }
}

fn hunk_selections(file_patch: &str, snapshot: &CommitSnapshot) -> Vec<PatchSelection> {
    let (path, old_path) = parse_paths(file_patch);
    let fallback_reason =
        if file_patch.contains("GIT binary patch") || file_patch.contains("Binary files ") {
            Some("binary".to_string())
        } else if old_path.is_some()
            || file_patch.contains("similarity index ")
            || file_patch.contains("rename from ")
        {
            Some("complex_rename".to_string())
        } else {
            None
        };
    if let Some(reason) = fallback_reason {
        return vec![PatchSelection {
            id: format!("file:{}", hash_text(&path)),
            file_path: path,
            old_path,
            hunk_header: "whole file".into(),
            patch: file_patch.to_string(),
            kind: PatchSelectionKind::WholeFileFallback,
            fallback_reason: Some(reason),
            snapshot: snapshot.clone(),
        }];
    }

    let lines: Vec<&str> = file_patch.lines().collect();
    let first_hunk = lines.iter().position(|line| line.starts_with("@@ "));
    let Some(first_hunk) = first_hunk else {
        return vec![PatchSelection {
            id: format!("file:{}", hash_text(&path)),
            file_path: path,
            old_path,
            hunk_header: "whole file".into(),
            patch: file_patch.to_string(),
            kind: PatchSelectionKind::WholeFileFallback,
            fallback_reason: Some("non_text_or_metadata_only".into()),
            snapshot: snapshot.clone(),
        }];
    };
    let prefix = lines[..first_hunk].join("\n");
    let mut starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| line.starts_with("@@ ").then_some(i))
        .collect();
    starts.push(lines.len());
    starts
        .windows(2)
        .enumerate()
        .map(|(ordinal, range)| {
            let body = lines[range[0]..range[1]].join("\n");
            let header = lines[range[0]].to_string();
            let patch = format!("{prefix}\n{body}\n");
            PatchSelection {
                id: format!("hunk:{}:{}", hash_text(&path), ordinal),
                file_path: path.clone(),
                old_path: old_path.clone(),
                hunk_header: header,
                patch,
                kind: PatchSelectionKind::Hunk,
                fallback_reason: None,
                snapshot: snapshot.clone(),
            }
        })
        .collect()
}

pub fn create_draft(repo: &Repository) -> AppResult<CommitPlanDraft> {
    let snapshot = capture_snapshot(repo)?;
    let existing_staged = has_staged_changes(repo)?;
    let diff = full_diff(repo)?;
    if diff.trim().is_empty() {
        return Err(AppError::General("没有可用于智能拆分的改动".into()));
    }
    let selections = split_file_patches(&diff)
        .into_iter()
        .flat_map(|patch| hunk_selections(&patch, &snapshot))
        .collect();
    Ok(CommitPlanDraft {
        snapshot,
        selections,
        existing_staged,
        warning: existing_staged.then(|| "检测到已有暂存改动。为避免混入拆分提交，智能执行已锁定；请先提交或取消暂存这些改动后重新生成计划。".into()),
    })
}

pub fn validate_snapshot(repo: &Repository, expected: &CommitSnapshot) -> AppResult<()> {
    let current = capture_snapshot(repo)?;
    if &current != expected {
        return Err(AppError::General(
            "智能拆分计划已失效：仓库路径、HEAD、暂存区树或 diff 已变化，请重新生成计划。".into(),
        ));
    }
    Ok(())
}

pub fn validate_plan(plan: &CommitPlan, draft: &CommitPlanDraft) -> AppResult<()> {
    if plan.groups.is_empty() {
        return Err(AppError::AiResponse("计划至少需要一个提交组".into()));
    }
    let conventional = Regex::new(r"^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\([A-Za-z0-9._/-]+\))?!?: .{1,72}").expect("regex");
    let expected: HashSet<&str> = draft.selections.iter().map(|s| s.id.as_str()).collect();
    let mut seen = HashSet::new();
    for group in &plan.groups {
        if group.reason.trim().is_empty()
            || !conventional.is_match(group.message.lines().next().unwrap_or_default())
        {
            return Err(AppError::AiResponse(
                "提交组理由为空或 message 不符合 Conventional Commits".into(),
            ));
        }
        if group.selections.is_empty() {
            return Err(AppError::AiResponse("提交组不能没有 hunk".into()));
        }
        for selection in &group.selections {
            if !expected.contains(selection.id.as_str()) || !seen.insert(selection.id.as_str()) {
                return Err(AppError::AiResponse("计划包含未知或重复 hunk".into()));
            }
        }
    }
    if seen.len() != expected.len() {
        return Err(AppError::AiResponse("计划必须且只能覆盖全部 hunk".into()));
    }
    Ok(())
}

pub fn fallback_plan(draft: &CommitPlanDraft, reason: &str) -> CommitPlan {
    CommitPlan {
        id: Uuid::new_v4().to_string(),
        schema_version: 1,
        snapshot: draft.snapshot.clone(),
        groups: vec![CommitGroup {
            id: Uuid::new_v4().to_string(),
            reason: reason.into(),
            message: "chore: 保存当前工作区改动".into(),
            selections: draft.selections.clone(),
            committed_hash: None,
        }],
        existing_staged: draft.existing_staged,
        fallback: true,
        warning: draft.warning.clone(),
    }
}

fn restore_index(repo: &Repository, tree_id: &str) -> AppResult<()> {
    let oid =
        git2::Oid::from_str(tree_id).map_err(|_| AppError::General("无效的暂存区恢复点".into()))?;
    let tree = repo.find_tree(oid)?;
    let mut index = repo.index()?;
    index.read_tree(&tree)?;
    index.write()?;
    Ok(())
}

pub fn stage_group(
    repo: &Repository,
    plan: &CommitPlan,
    group_id: &str,
) -> AppResult<StageGroupResult> {
    validate_snapshot(repo, &plan.snapshot)?;
    if plan.existing_staged || has_staged_changes(repo)? {
        return Err(AppError::General(
            "已有暂存改动，智能拆分不会修改暂存区。请先处理后重新生成计划。".into(),
        ));
    }
    let group = plan
        .groups
        .iter()
        .find(|g| g.id == group_id)
        .ok_or_else(|| AppError::General("提交组不存在".into()))?;
    let original_tree = plan.snapshot.index_tree.clone();
    let workdir = cli::workdir(repo)?;
    for selection in &group.selections {
        let result = match selection.kind {
            PatchSelectionKind::Hunk => super::commit::apply_patch_to_index(repo, &selection.patch),
            PatchSelectionKind::WholeFileFallback => {
                cli::validate_pathspec(&selection.file_path, "文件路径")?;
                cli::run_checked(
                    workdir,
                    [
                        "add".to_string(),
                        "--".to_string(),
                        selection.file_path.clone(),
                    ],
                    LOCAL_TIMEOUT,
                    "显式暂存回退文件失败",
                )
                .map(|_| ())
            }
        };
        if let Err(error) = result {
            let _ = restore_index(repo, &original_tree);
            return Err(AppError::General(format!(
                "暂存提交组失败，暂存区已恢复到执行前状态：{error}"
            )));
        }
    }
    Ok(StageGroupResult {
        group_id: group_id.into(),
        staged_tree: index_tree(repo)?,
        state: "awaiting_commit_confirmation".into(),
        recovery:
            "该组已暂存但尚未提交。可显式确认提交，或使用常规取消暂存恢复。应用不会自动继续下一组。"
                .into(),
    })
}

pub fn commit_group(
    repo: &Repository,
    mut plan: CommitPlan,
    group_id: &str,
    staged_tree: &str,
) -> AppResult<CommitGroupResult> {
    if canonical_repo_path(repo)? != plan.snapshot.repo_path
        || head(repo)? != plan.snapshot.head
        || hash_text(&full_diff(repo)?) != plan.snapshot.diff_hash
    {
        return Err(AppError::General(
            "提交前快照验证失败：HEAD、路径或工作区 diff 已变化；当前已暂存内容保留供人工恢复。"
                .into(),
        ));
    }
    if index_tree(repo)? != staged_tree {
        return Err(AppError::General(
            "提交前暂存区已变化；未执行提交，当前暂存内容保持不变。".into(),
        ));
    }
    let group_index = plan
        .groups
        .iter()
        .position(|g| g.id == group_id)
        .ok_or_else(|| AppError::General("提交组不存在".into()))?;
    let message = plan.groups[group_index].message.clone();
    let commit_hash = super::commit::commit(repo, &message)?;
    plan.groups[group_index].committed_hash = Some(commit_hash.clone());
    let next_snapshot = capture_snapshot(repo)?;
    plan.snapshot = next_snapshot.clone();
    for group in &mut plan.groups {
        if group.committed_hash.is_none() {
            for selection in &mut group.selections {
                selection.snapshot = next_snapshot.clone();
            }
        }
    }
    Ok(CommitGroupResult {
        group_id: group_id.into(),
        commit_hash,
        state: "paused_after_commit".into(),
        recovery: "该组已提交。计划已重新绑定到新 HEAD；下一组必须再次单独预览、暂存并确认，应用不会自动连续提交。".into(),
        plan,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPlanPayload {
    pub groups: Vec<AiPlanGroup>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPlanGroup {
    pub reason: String,
    pub message: String,
    pub hunk_ids: Vec<String>,
}

pub fn finish_ai_plan(raw: &str, draft: &CommitPlanDraft) -> AppResult<CommitPlan> {
    let trimmed = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let payload: AiPlanPayload = serde_json::from_str(trimmed)
        .map_err(|e| AppError::AiResponse(format!("无法解析拆分计划 JSON：{e}")))?;
    let by_id: HashMap<&str, &PatchSelection> = draft
        .selections
        .iter()
        .map(|s| (s.id.as_str(), s))
        .collect();
    let groups = payload
        .groups
        .into_iter()
        .map(|group| {
            let selections = group
                .hunk_ids
                .into_iter()
                .map(|id| {
                    by_id
                        .get(id.as_str())
                        .map(|s| (*s).clone())
                        .ok_or_else(|| AppError::AiResponse(format!("未知 hunk id：{id}")))
                })
                .collect::<AppResult<Vec<_>>>()?;
            Ok(CommitGroup {
                id: Uuid::new_v4().to_string(),
                reason: group.reason,
                message: group.message,
                selections,
                committed_hash: None,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let plan = CommitPlan {
        id: Uuid::new_v4().to_string(),
        schema_version: 1,
        snapshot: draft.snapshot.clone(),
        groups,
        existing_staged: draft.existing_staged,
        fallback: false,
        warning: draft.warning.clone(),
    };
    validate_plan(&plan, draft)?;
    Ok(plan)
}

pub fn ai_input(draft: &CommitPlanDraft) -> String {
    draft
        .selections
        .iter()
        .map(|s| {
            format!(
                "ID: {}\nFILE: {}\nHUNK: {}\nPATCH:\n{}",
                s.id, s.file_path, s.hunk_header, s.patch
            )
        })
        .collect::<Vec<_>>()
        .join("\n---\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn git(root: &Path, args: &[&str]) {
        cli::run_checked(root, args.iter().copied(), LOCAL_TIMEOUT, "test git failed").unwrap();
    }

    fn temp_repo(name: &str) -> (std::path::PathBuf, Repository) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aigit-smart-{name}-{unique}"));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        git(&root, &["config", "user.name", "Test"]);
        git(&root, &["config", "user.email", "test@example.com"]);
        fs::write(root.join("file.txt"), "base\n").unwrap();
        git(&root, &["add", "file.txt"]);
        git(&root, &["commit", "-m", "initial"]);
        let repo = Repository::open(&root).unwrap();
        (root, repo)
    }

    #[test]
    fn snapshot_detects_worktree_index_and_head_changes() {
        let (root, repo) = temp_repo("snapshot");
        fs::write(root.join("file.txt"), "worktree one\n").unwrap();
        let original = capture_snapshot(&repo).unwrap();
        validate_snapshot(&repo, &original).unwrap();

        fs::write(root.join("file.txt"), "worktree two\n").unwrap();
        assert!(validate_snapshot(&repo, &original).is_err());

        let after_worktree = capture_snapshot(&repo).unwrap();
        git(&root, &["add", "file.txt"]);
        let reopened = Repository::open(&root).unwrap();
        assert!(validate_snapshot(&reopened, &after_worktree).is_err());

        git(&root, &["commit", "-m", "second"]);
        let committed = Repository::open(&root).unwrap();
        let after_head = capture_snapshot(&committed).unwrap();
        assert_ne!(after_head.head, original.head);
        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn draft_splits_text_hunks_and_locks_existing_staged_changes() {
        let (root, repo) = temp_repo("draft");
        fs::write(root.join("file.txt"), "changed\n").unwrap();
        fs::write(root.join("other.txt"), "new\n").unwrap();
        git(&root, &["add", "other.txt"]);

        let draft = create_draft(&repo).unwrap();

        assert!(draft.existing_staged);
        assert!(draft.warning.is_some());
        assert!(draft
            .selections
            .iter()
            .any(|selection| selection.file_path == "file.txt"));
        assert!(draft
            .selections
            .iter()
            .any(|selection| selection.file_path == "other.txt"));
        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn structured_plan_requires_exact_unique_coverage() {
        let snapshot = CommitSnapshot {
            repo_path: "x".into(),
            head: "h".into(),
            index_tree: "i".into(),
            diff_hash: "d".into(),
        };
        let selection = PatchSelection {
            id: "hunk:1:0".into(),
            file_path: "a.rs".into(),
            old_path: None,
            hunk_header: "@@ -1 +1 @@".into(),
            patch: "patch".into(),
            kind: PatchSelectionKind::Hunk,
            fallback_reason: None,
            snapshot: snapshot.clone(),
        };
        let draft = CommitPlanDraft {
            snapshot,
            selections: vec![selection],
            existing_staged: false,
            warning: None,
        };
        let plan = finish_ai_plan(r#"{"groups":[{"reason":"one concern","message":"fix(core): correct value","hunk_ids":["hunk:1:0"]}]}"#, &draft).expect("valid plan");
        assert_eq!(plan.groups.len(), 1);
        assert!(finish_ai_plan(
            r#"{"groups":[{"reason":"x","message":"not conventional","hunk_ids":["hunk:1:0"]}]}"#,
            &draft
        )
        .is_err());
    }
}
