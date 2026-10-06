//! 操作历史（撤销中心）：记录会改动 HEAD 的 git 操作，并支持把分支安全地
//! 恢复到操作前的位置。
//!
//! 存储遵循代码索引的先例：`data_local_dir/aigit/op-history/{sha256(path)}.json`，
//! 每个仓库一个文件，全局锁串行化读写，原子写覆盖。
//!
//! 撤销语义：
//! - `checkout` 类：切回操作前的分支（不移动分支指针）。
//! - 其余可撤销操作：先守护（无进行中的 merge/rebase、未切走分支、脏工作区
//!   需显式确认自动 stash），再把当前 HEAD 备份成 `aigit/undo-backup-*` 分支，
//!   最后把当前分支 `reset --hard` 回操作前的提交。任何一步失败都不会丢数据：
//!   备份分支建立之前绝不执行 reset。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use sha2::Digest;

use crate::error::{AppError, AppResult};

pub const KIND_PULL: &str = "pull";
pub const KIND_PUSH: &str = "push";
pub const KIND_MERGE: &str = "merge";
pub const KIND_REBASE: &str = "rebase";
pub const KIND_REVERT: &str = "revert";
pub const KIND_CHERRY_PICK: &str = "cherry_pick";
pub const KIND_RESET: &str = "reset";
pub const KIND_CHECKOUT: &str = "checkout";
pub const KIND_DISCARD: &str = "discard";
pub const KIND_REWRITE: &str = "history_rewrite";
pub const KIND_UNDO: &str = "undo";

/// 操作前的 HEAD 位置快照，是"撤销"的恢复目标。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Position {
    pub branch_before: Option<String>,
    pub head_before: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationRecord {
    pub id: String,
    /// Unix 秒。
    pub timestamp: i64,
    /// [`KIND_*`] 常量之一。
    pub kind: String,
    /// 面向用户的一行描述（分支名/哈希等中性词汇，展示层负责本地化动词）。
    pub summary: String,
    pub branch_before: Option<String>,
    pub head_before: Option<String>,
    /// `false` 表示没有可靠的恢复目标（如 push、丢弃工作区改动）。
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UndoOutcome {
    /// 撤销前自动创建的备份分支名（指向撤销时的 HEAD）。
    pub backup_branch: Option<String>,
    pub stashed: bool,
    /// checkout 类撤销切回的分支名。
    pub switched_to: Option<String>,
}

/// 记录条数上限的兜底值（config.toml 损坏时仍可记录）。
const FALLBACK_MAX_ENTRIES: usize = 200;

static OP_LOG_LOCK: Mutex<()> = Mutex::new(());

/// 读取 HEAD 位置；unborn HEAD 时分支名仍有值、提交为空。
pub fn capture_position(repo: &git2::Repository) -> Position {
    let branch_before = current_branch_or_unborn(repo);
    let head_before = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .map(|commit| commit.id().to_string());
    Position {
        branch_before,
        head_before,
    }
}

/// 当前分支名；unborn HEAD 返回其目标分支名，detached HEAD 返回 None。
fn current_branch_or_unborn(repo: &git2::Repository) -> Option<String> {
    match repo.head() {
        Ok(head) if head.is_branch() => head.shorthand().map(str::to_string),
        Ok(_) => None,
        Err(_) => unborn_branch_name(repo),
    }
}

fn unborn_branch_name(repo: &git2::Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    if !head.is_symbolic() {
        return None;
    }
    let target = head.symbolic_target()?;
    Some(
        target
            .strip_prefix("refs/heads/")
            .unwrap_or(target)
            .to_string(),
    )
}

fn history_root() -> AppResult<PathBuf> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| AppError::Config("Cannot determine local data directory".into()))?
        .join("aigit")
        .join("op-history");
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn repo_key(repo_path: &str) -> String {
    let canonical = fs::canonicalize(repo_path).unwrap_or_else(|_| PathBuf::from(repo_path));
    let digest = sha2::Sha256::digest(canonical.to_string_lossy().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn store_path(root: &Path, repo_path: &str) -> PathBuf {
    root.join(format!("{}.json", repo_key(repo_path)))
}

/// 从 config.toml 读取记录开关与条数上限（轻量读取，避免每次 git 操作
/// 都触碰系统凭据库）。读不到就用默认值。
fn ops_settings() -> (bool, usize) {
    let Some(path) = crate::config::AppConfig::config_file_path().ok() else {
        return (true, FALLBACK_MAX_ENTRIES);
    };
    let Ok(content) = fs::read_to_string(path) else {
        return (true, FALLBACK_MAX_ENTRIES);
    };
    let Ok(value) = toml::from_str::<toml::Value>(&content) else {
        return (true, FALLBACK_MAX_ENTRIES);
    };
    let ops = value.get("ops");
    let enabled = ops
        .and_then(|ops| ops.get("op_log_enabled"))
        .and_then(toml::Value::as_bool)
        .unwrap_or(true);
    let max_entries = ops
        .and_then(|ops| ops.get("op_log_max_entries"))
        .and_then(toml::Value::as_integer)
        .map(|value| value.clamp(10, 1_000) as usize)
        .unwrap_or(FALLBACK_MAX_ENTRIES);
    (enabled, max_entries)
}

fn load_from(root: &Path, repo_path: &str) -> Vec<OperationRecord> {
    let Ok(content) = fs::read_to_string(store_path(root, repo_path)) else {
        return Vec::new();
    };
    match serde_json::from_str(&content) {
        Ok(records) => records,
        Err(error) => {
            log::warn!("操作历史文件损坏，按空处理：{error}");
            Vec::new()
        }
    }
}

fn save_from(root: &Path, repo_path: &str, records: &[OperationRecord]) -> AppResult<()> {
    fs::create_dir_all(root)?;
    let content = serde_json::to_vec(records)?;
    let file = AtomicFile::new(store_path(root, repo_path), AllowOverwrite);
    file.write(|handle| handle.write_all(&content))
        .map_err(|error| {
            AppError::Io(std::io::Error::other(format!(
                "Failed to write operation history: {error}"
            )))
        })
}

fn trim(records: &mut Vec<OperationRecord>, max_entries: usize) {
    let max_entries = max_entries.clamp(10, 1_000);
    if records.len() > max_entries {
        let drop_count = records.len() - max_entries;
        records.drain(0..drop_count);
    }
}

fn push_entry(
    root: &Path,
    repo_path: &str,
    entry: OperationRecord,
    max_entries: usize,
) -> AppResult<()> {
    let mut records = load_from(root, repo_path);
    records.push(entry);
    trim(&mut records, max_entries);
    save_from(root, repo_path, &records)
}

/// 记录一条成功执行的操作。尽力而为：任何失败只写日志，绝不影响原操作。
pub fn record(repo_path: &str, kind: &str, summary: String, position: Position, reversible: bool) {
    let (enabled, max_entries) = ops_settings();
    if !enabled {
        return;
    }
    let entry = OperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        kind: kind.to_string(),
        summary,
        branch_before: position.branch_before,
        head_before: position.head_before,
        reversible,
    };
    let result = history_root()
        .and_then(|root| {
            let _guard = OP_LOG_LOCK.lock();
            push_entry(&root, repo_path, entry, max_entries)
        })
        .err();
    if let Some(error) = result {
        log::warn!("记录操作历史失败（不影响原操作）：{error}");
    }
}

/// 操作历史，最新的在最前。
pub fn list(repo_path: &str) -> AppResult<Vec<OperationRecord>> {
    let root = history_root()?;
    let _guard = OP_LOG_LOCK.lock();
    let mut records = load_from(&root, repo_path);
    records.reverse();
    Ok(records)
}

pub fn clear(repo_path: &str) -> AppResult<()> {
    let root = history_root()?;
    let _guard = OP_LOG_LOCK.lock();
    let path = store_path(&root, repo_path);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn short_id(head_before: &str) -> String {
    head_before.chars().take(7).collect()
}

/// 撤销一条操作。先做全部防呆检查，再创建备份分支，最后才执行 reset。
/// 调用期间持有 [`OP_LOG_LOCK`]，内部记录撤销条目时不得再加锁。
pub fn undo(repo_path: &str, record_id: &str, stash_dirty: bool) -> AppResult<UndoOutcome> {
    let root = history_root()?;
    let _guard = OP_LOG_LOCK.lock();
    undo_in(&root, repo_path, record_id, stash_dirty)
}

fn undo_in(
    root: &Path,
    repo_path: &str,
    record_id: &str,
    stash_dirty: bool,
) -> AppResult<UndoOutcome> {
    let repo = crate::git::repo::open_repo(repo_path)?;
    let records = load_from(root, repo_path);
    let record = records
        .iter()
        .find(|entry| entry.id == record_id)
        .ok_or_else(|| AppError::General("操作记录不存在或已被清理".into()))?
        .clone();
    if !record.reversible {
        return Err(AppError::General(format!(
            "该操作不可自动撤销：{}",
            record.summary
        )));
    }
    if crate::git::merge::is_merging(&repo) || crate::git::merge::is_rebasing(&repo) {
        return Err(AppError::General(
            "存在进行中的合并/变基操作，请先完成或中止后再撤销".into(),
        ));
    }

    if record.kind == KIND_CHECKOUT {
        undo_checkout(&repo, repo_path, root, &record)
    } else {
        undo_reset(&repo, repo_path, root, &record, stash_dirty)
    }
}

fn undo_checkout(
    repo: &git2::Repository,
    repo_path: &str,
    root: &Path,
    record: &OperationRecord,
) -> AppResult<UndoOutcome> {
    let Some(branch_before) = record.branch_before.clone() else {
        return Err(AppError::General(
            "该操作前没有已知的分支位置，无法自动切回；请使用 reflog 恢复面板".into(),
        ));
    };
    if crate::git::repo::get_current_branch_name(repo).as_deref() == Some(branch_before.as_str()) {
        return Ok(UndoOutcome {
            backup_branch: None,
            stashed: false,
            switched_to: None,
        });
    }
    crate::git::branch::switch_branch(repo, &branch_before, false)?;
    record_in(
        root,
        repo_path,
        KIND_UNDO,
        format!("undo: switch back to {branch_before}"),
        Position::default(),
    );
    Ok(UndoOutcome {
        backup_branch: None,
        stashed: false,
        switched_to: Some(branch_before),
    })
}

fn undo_reset(
    repo: &git2::Repository,
    repo_path: &str,
    root: &Path,
    record: &OperationRecord,
    stash_dirty: bool,
) -> AppResult<UndoOutcome> {
    let Some(head_before) = record.head_before.clone() else {
        return Err(AppError::General(
            "该操作没有可恢复的 HEAD 位置；请使用 reflog 恢复面板".into(),
        ));
    };
    let current_branch = crate::git::repo::get_current_branch_name(repo)
        .ok_or_else(|| AppError::General("当前处于 detached HEAD，请先检出分支后再撤销".into()))?;
    if record
        .branch_before
        .as_deref()
        .is_some_and(|branch| branch != current_branch)
    {
        return Err(AppError::General(format!(
            "该操作发生在分支 {} 上，当前在分支 {current_branch}；请先切回原分支再撤销",
            record.branch_before.as_deref().unwrap_or("?")
        )));
    }

    // 脏工作区守护：未确认时拒绝；确认后先 stash（含未跟踪文件）再继续。
    let mut stashed = false;
    if !crate::git::status::get_status(repo)?.is_empty() {
        if !stash_dirty {
            return Err(AppError::UncommittedChanges(
                "存在未提交改动；请先提交或暂存，或在撤销时选择自动 stash".into(),
            ));
        }
        crate::git::stash::stash_save(repo, Some("aigit 撤销前自动备份"), true, false)?;
        stashed = true;
    }

    // 备份当前 HEAD：备份分支建立成功之前绝不执行 reset。
    let current_head = repo.head()?.peel_to_commit()?.id().to_string();
    if current_head != head_before {
        let backup_branch = unique_backup_branch(repo)?;
        crate::git::branch::create_branch(repo, &backup_branch, Some(&current_head))?;
        crate::git::history::reset_to_commit(repo, &head_before, "hard")?;
        record_in(
            root,
            repo_path,
            KIND_UNDO,
            format!(
                "undo: {} → restore {} (backup {backup_branch})",
                record.summary,
                short_id(&head_before)
            ),
            Position::default(),
        );
        return Ok(UndoOutcome {
            backup_branch: Some(backup_branch),
            stashed,
            switched_to: None,
        });
    }

    // HEAD 本就没动过：无需备份与 reset，仅留一条说明。
    record_in(
        root,
        repo_path,
        KIND_UNDO,
        format!("undo: {} (HEAD unchanged, no reset)", record.summary),
        Position::default(),
    );
    Ok(UndoOutcome {
        backup_branch: None,
        stashed,
        switched_to: None,
    })
}

fn unique_backup_branch(repo: &git2::Repository) -> AppResult<String> {
    let base = format!(
        "aigit/undo-backup-{}",
        chrono::Utc::now().timestamp_subsec_millis()
    );
    let mut candidate = base.clone();
    let mut counter = 1u32;
    while repo
        .find_branch(&candidate, git2::BranchType::Local)
        .is_ok()
    {
        counter += 1;
        candidate = format!("{base}-{counter}");
        if counter > 100 {
            return Err(AppError::General("无法生成可用的备份分支名".into()));
        }
    }
    Ok(candidate)
}

/// 仅在已持有 [`OP_LOG_LOCK`] 的路径（撤销流程）与测试中调用。
fn record_in(root: &Path, repo_path: &str, kind: &str, summary: String, position: Position) {
    let entry = OperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        kind: kind.to_string(),
        summary,
        branch_before: position.branch_before,
        head_before: position.head_before,
        reversible: false,
    };
    let result = push_entry(root, repo_path, entry, FALLBACK_MAX_ENTRIES).err();
    if let Some(error) = result {
        log::warn!("记录操作历史失败（不影响原操作）：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Signature, Time};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> git2::Repository {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aigit-op-log-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let repo = git2::Repository::init(&dir).expect("init repo");
        let mut config = repo.config().expect("repo config");
        config.set_bool("core.autocrlf", false).expect("autocrlf");
        repo
    }

    fn temp_root(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aigit-op-log-store-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn commit_all(repo: &git2::Repository, message: &str, time: i64) -> String {
        let workdir = repo.workdir().expect("workdir");
        fs::write(
            workdir.join(format!("file-{time}.txt")),
            format!("content {time}\n"),
        )
        .expect("write file");
        let mut index = repo.index().expect("index");
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("index write");
        let signature =
            Signature::new("tester", "tester@example.com", &Time::new(time, 0)).expect("signature");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("tree");
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .expect("commit")
        .to_string()
    }

    fn last_record_id(root: &Path, repo_path: &str) -> String {
        load_from(root, repo_path)
            .last()
            .expect("record")
            .id
            .clone()
    }

    #[test]
    fn round_trip_and_trim_keep_newest_entries() {
        let root = temp_root("round-trip");
        let repo_path = "/nonexistent/aigit-op-log-fixture";
        for index in 0..15 {
            record_in(
                &root,
                repo_path,
                KIND_RESET,
                format!("op {index}"),
                Position::default(),
            );
        }
        let records = load_from(&root, repo_path);
        assert_eq!(records.len(), 15);
        assert_eq!(records.last().expect("last").summary, "op 14");

        let mut overflow = records;
        overflow.push(OperationRecord {
            id: "extra".into(),
            timestamp: 0,
            kind: KIND_RESET.into(),
            summary: "extra".into(),
            branch_before: None,
            head_before: None,
            reversible: true,
        });
        trim(&mut overflow, 10);
        assert_eq!(overflow.len(), 10);
        assert_eq!(overflow.first().expect("first").summary, "op 6");
        assert_eq!(overflow.last().expect("last").summary, "extra");
    }

    #[test]
    fn capture_position_reports_unborn_head_branch_without_commit() {
        let repo = temp_repo("unborn");
        let position = capture_position(&repo);
        assert!(position.head_before.is_none());
        assert_eq!(position.branch_before, unborn_branch_name(&repo));
        assert!(position.branch_before.is_some());
    }

    #[test]
    fn undo_restores_branch_to_position_before_operation_with_backup() {
        let root = temp_root("undo");
        let repo = temp_repo("undo");
        let repo_path = repo
            .workdir()
            .expect("workdir")
            .to_string_lossy()
            .to_string();

        let first = commit_all(&repo, "feat: first", 1_700_000_000);
        let position = capture_position(&repo);
        let second = commit_all(&repo, "feat: second", 1_700_000_100);

        record_in(&root, &repo_path, KIND_RESET, "reset --hard demo", position);
        let record_id = last_record_id(&root, &repo_path);

        let outcome = undo_in(&root, &repo_path, &record_id, false).expect("undo");

        // 分支被重置回操作前的提交。
        let head_now = repo
            .head()
            .expect("head")
            .peel_to_commit()
            .expect("commit")
            .id()
            .to_string();
        assert_eq!(head_now, first);
        assert_ne!(head_now, second);
        // 撤销前的位置被备份成分支。
        let backup = outcome.backup_branch.expect("backup branch");
        let backup_target = repo
            .find_branch(&backup, git2::BranchType::Local)
            .expect("backup branch")
            .get()
            .peel_to_commit()
            .expect("commit")
            .id()
            .to_string();
        assert_eq!(backup_target, second);
        // 撤销本身也留痕。
        let after = load_from(&root, &repo_path);
        assert_eq!(after.last().expect("last").kind, KIND_UNDO);
    }

    #[test]
    fn undo_refuses_dirty_worktree_unless_stash_confirmed() {
        let root = temp_root("dirty");
        let repo = temp_repo("dirty");
        let repo_path = repo
            .workdir()
            .expect("workdir")
            .to_string_lossy()
            .to_string();

        let first = commit_all(&repo, "feat: first", 1_700_000_000);
        let position = capture_position(&repo);
        let second = commit_all(&repo, "feat: second", 1_700_000_100);
        record_in(&root, &repo_path, KIND_RESET, "reset demo", position);
        let record_id = last_record_id(&root, &repo_path);

        // 制造脏工作区。
        fs::write(
            repo.workdir().expect("workdir").join("dirty.txt"),
            "local change\n",
        )
        .expect("write dirty file");

        let refused = undo_in(&root, &repo_path, &record_id, false);
        assert!(matches!(refused, Err(AppError::UncommittedChanges(_))));

        // 确认 stash 后成功撤销，分支恢复到操作前。
        let outcome = undo_in(&root, &repo_path, &record_id, true).expect("undo with stash");
        assert!(outcome.stashed);
        let head_now = repo
            .head()
            .expect("head")
            .peel_to_commit()
            .expect("commit")
            .id()
            .to_string();
        assert_eq!(head_now, first);
        assert_ne!(head_now, second);
    }

    #[test]
    fn undo_rejects_irreversible_records() {
        let root = temp_root("irreversible");
        let repo = temp_repo("irreversible");
        let repo_path = repo
            .workdir()
            .expect("workdir")
            .to_string_lossy()
            .to_string();
        let _ = commit_all(&repo, "feat: first", 1_700_000_000);
        record_in(
            &root,
            &repo_path,
            KIND_DISCARD,
            "discard 1 file",
            Position::default(),
        );
        let record_id = last_record_id(&root, &repo_path);

        assert!(undo_in(&root, &repo_path, &record_id, false).is_err());
    }
}
