use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::NaiveDate;

use crate::error::{AppError, AppResult};
use crate::git;

#[derive(Default)]
pub struct GitTaskRegistry {
    tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl GitTaskRegistry {
    fn start(&self, task_id: &str) -> AppResult<Arc<AtomicBool>> {
        if task_id.trim().is_empty() {
            return Err(AppError::General("Git task id 不能为空".into()));
        }
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| AppError::General("Git task registry 不可用".into()))?;
        if tasks.contains_key(task_id) {
            return Err(AppError::General("同名 Git task 已在运行".into()));
        }
        let flag = Arc::new(AtomicBool::new(false));
        tasks.insert(task_id.to_string(), flag.clone());
        Ok(flag)
    }

    fn finish(&self, task_id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(task_id);
        }
    }

    fn cancel(&self, task_id: &str) -> AppResult<bool> {
        let tasks = self
            .tasks
            .lock()
            .map_err(|_| AppError::General("Git task registry 不可用".into()))?;
        if let Some(flag) = tasks.get(task_id) {
            flag.store(true, Ordering::Relaxed);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

fn run_remote_task<T>(
    registry: &GitTaskRegistry,
    task_id: &str,
    action: impl FnOnce(Arc<AtomicBool>) -> AppResult<T>,
) -> AppResult<T> {
    let cancellation = registry.start(task_id)?;
    let result = action(cancellation);
    registry.finish(task_id);
    result
}

fn parse_insights_date(value: Option<String>, field: &str) -> AppResult<Option<NaiveDate>> {
    value
        .map(|date| {
            NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                .map_err(|_| AppError::General(format!("Invalid {field}; expected YYYY-MM-DD")))
        })
        .transpose()
}

#[tauri::command]
pub async fn get_repository_insights(
    path: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> crate::error::AppResult<git::insights::RepositoryInsights> {
    let start_date = parse_insights_date(start_date, "start date")?;
    let end_date = parse_insights_date(end_date, "end date")?;
    if matches!((start_date, end_date), (Some(start), Some(end)) if start > end) {
        return Err(AppError::General(
            "Start date must not be after end date".into(),
        ));
    }
    tokio::task::spawn_blocking(move || {
        let repo = git::repo::open_repo(&path)?;
        git::insights::collect_insights(&repo, start_date, end_date)
    })
    .await
    .map_err(|e| crate::error::AppError::General(format!("Insights task failed: {e}")))?
}

#[tauri::command]
pub fn discover_repo(path: String) -> AppResult<String> {
    git::repo::discover_repo(&path)
}

#[tauri::command]
pub fn init_repo(path: String) -> AppResult<()> {
    git::repo::init_repo(&path)
}

#[tauri::command]
pub fn clone_repo(url: String, target_path: String) -> AppResult<()> {
    git::repo::clone_repo(&url, &target_path)
}

#[tauri::command]
pub fn get_repo_info(path: String) -> AppResult<git::RepoInfo> {
    let repo = git::repo::open_repo(&path)?;
    git::repo::get_repo_info(&repo)
}

#[tauri::command]
pub fn get_status(path: String) -> AppResult<Vec<git::FileStatus>> {
    let repo = git::repo::open_repo(&path)?;
    git::status::get_status(&repo)
}

#[tauri::command]
pub fn get_workdir_diff(path: String, file_path: Option<String>) -> AppResult<Vec<git::FileDiff>> {
    let repo = git::repo::open_repo(&path)?;
    git::diff::get_workdir_diff(&repo, file_path.as_deref())
}

#[tauri::command]
pub fn get_staged_diff(path: String, file_path: Option<String>) -> AppResult<Vec<git::FileDiff>> {
    let repo = git::repo::open_repo(&path)?;
    git::diff::get_staged_diff(&repo, file_path.as_deref())
}

#[tauri::command]
pub fn stage_files(path: String, files: Vec<String>) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::stage_files(&repo, &files)
}

#[tauri::command]
pub fn stage_all(path: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::stage_all(&repo)
}

#[tauri::command]
pub fn unstage_files(path: String, files: Vec<String>) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::unstage_files(&repo, &files)
}

#[tauri::command]
pub fn commit(path: String, message: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::commit(&repo, &message)
}

#[tauri::command]
pub fn amend(
    path: String,
    message: String,
    include_staged: Option<bool>,
    confirm_pushed: Option<bool>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::amend(
        &repo,
        &message,
        include_staged.unwrap_or(false),
        confirm_pushed.unwrap_or(false),
    )
}

#[tauri::command]
pub fn is_head_pushed(path: String) -> AppResult<bool> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::head_is_pushed(&repo)
}

#[tauri::command]
pub fn apply_patch_to_index(path: String, patch: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::apply_patch_to_index(&repo, &patch)
}

#[tauri::command]
pub fn apply_patch_to_index_reverse(path: String, patch: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::apply_patch_to_index_reverse(&repo, &patch)
}

#[tauri::command]
pub fn create_smart_commit_draft(path: String) -> AppResult<git::smart_commit::CommitPlanDraft> {
    let repo = git::repo::open_repo(&path)?;
    git::smart_commit::create_draft(&repo)
}

#[tauri::command]
pub fn validate_smart_commit_plan(
    path: String,
    plan: git::smart_commit::CommitPlan,
) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::smart_commit::validate_snapshot(&repo, &plan.snapshot)
}

#[tauri::command]
pub fn stage_smart_commit_group(
    path: String,
    plan: git::smart_commit::CommitPlan,
    group_id: String,
) -> AppResult<git::smart_commit::StageGroupResult> {
    let repo = git::repo::open_repo(&path)?;
    git::smart_commit::stage_group(&repo, &plan, &group_id)
}

#[tauri::command]
pub fn commit_smart_commit_group(
    path: String,
    plan: git::smart_commit::CommitPlan,
    group_id: String,
    staged_tree: String,
) -> AppResult<git::smart_commit::CommitGroupResult> {
    let repo = git::repo::open_repo(&path)?;
    git::smart_commit::commit_group(&repo, plan, &group_id, &staged_tree)
}

#[tauri::command]
pub fn list_branches(path: String) -> AppResult<Vec<git::BranchInfo>> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::list_branches(&repo)
}

#[tauri::command]
pub fn create_branch(path: String, name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::create_branch(&repo, &name)
}

#[tauri::command]
pub fn switch_branch(path: String, name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::switch_branch(&repo, &name)
}

#[tauri::command]
pub fn delete_branch(path: String, name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::delete_branch(&repo, &name)
}

#[tauri::command]
pub fn get_log(path: String, limit: Option<usize>) -> AppResult<Vec<git::LogEntry>> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::get_log(&repo, limit.unwrap_or(100))
}

#[tauri::command]
pub fn get_commit_diff(path: String, hash: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::get_commit_diff(&repo, &hash)
}

#[tauri::command]
pub fn list_files(path: String) -> AppResult<Vec<String>> {
    let repo = git::repo::open_repo(&path)?;
    git::branch::list_files(&repo)
}

#[tauri::command]
pub fn list_remotes(path: String) -> AppResult<Vec<git::RemoteInfo>> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::list_remotes(&repo)
}

#[tauri::command]
pub fn add_remote(path: String, name: String, url: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::add_remote(&repo, &name, &url)
}

#[tauri::command]
pub fn edit_remote(path: String, old_name: String, new_name: String, url: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::edit_remote(&repo, &old_name, &new_name, &url)
}

#[tauri::command]
pub fn remove_remote(path: String, name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::remove_remote(&repo, &name)
}

#[tauri::command]
pub fn rename_remote(path: String, old_name: String, new_name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::rename_remote(&repo, &old_name, &new_name)
}

#[tauri::command]
pub fn set_remote_url(
    path: String,
    name: String,
    url: String,
    push: Option<bool>,
) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::set_remote_url(&repo, &name, &url, push.unwrap_or(false))
}

#[tauri::command]
pub fn get_tracking_info(path: String) -> AppResult<git::TrackingInfo> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::tracking_info(&repo)
}

#[tauri::command]
pub fn set_upstream(
    path: String,
    remote: String,
    remote_branch: String,
) -> AppResult<git::TrackingInfo> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::set_upstream(&repo, &remote, &remote_branch)
}

#[tauri::command]
pub fn fetch(
    path: String,
    remote: Option<String>,
    prune: Option<bool>,
    tags: Option<bool>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::fetch(
        &repo,
        remote.as_deref(),
        prune.unwrap_or(false),
        tags.unwrap_or(false),
    )
}

#[tauri::command]
pub fn push(
    path: String,
    remote: Option<String>,
    remote_branch: Option<String>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::push_current_branch(&repo, remote.as_deref(), remote_branch.as_deref())
}

#[tauri::command]
pub fn pull(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::pull_current_branch(&repo)
}

#[tauri::command]
pub fn fetch_task(
    path: String,
    remote: Option<String>,
    prune: Option<bool>,
    tags: Option<bool>,
    task_id: String,
    registry: tauri::State<'_, GitTaskRegistry>,
) -> AppResult<String> {
    run_remote_task(&registry, &task_id, move |cancellation| {
        let repo = git::repo::open_repo(&path)?;
        git::remote::fetch_cancellable(
            &repo,
            remote.as_deref(),
            prune.unwrap_or(false),
            tags.unwrap_or(false),
            Some(cancellation),
        )
    })
}

#[tauri::command]
pub fn push_task(
    path: String,
    remote: Option<String>,
    remote_branch: Option<String>,
    task_id: String,
    registry: tauri::State<'_, GitTaskRegistry>,
) -> AppResult<String> {
    run_remote_task(&registry, &task_id, move |cancellation| {
        let repo = git::repo::open_repo(&path)?;
        git::remote::push_current_branch_cancellable(
            &repo,
            remote.as_deref(),
            remote_branch.as_deref(),
            Some(cancellation),
        )
    })
}

#[tauri::command]
pub fn pull_task(
    path: String,
    task_id: String,
    registry: tauri::State<'_, GitTaskRegistry>,
) -> AppResult<String> {
    run_remote_task(&registry, &task_id, move |cancellation| {
        let repo = git::repo::open_repo(&path)?;
        git::remote::pull_current_branch_cancellable(&repo, Some(cancellation))
    })
}

#[tauri::command]
pub fn cancel_git_task(
    task_id: String,
    registry: tauri::State<'_, GitTaskRegistry>,
) -> AppResult<bool> {
    registry.cancel(&task_id)
}

#[tauri::command]
pub fn create_tracking_branch(
    path: String,
    remote_branch: String,
    local_name: Option<String>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::create_tracking_branch(&repo, &remote_branch, local_name.as_deref())
}

#[tauri::command]
pub fn push_tag(path: String, remote: String, tag: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::push_tag(&repo, &remote, &tag)
}

#[tauri::command]
pub fn delete_remote_tag(path: String, remote: String, tag: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::delete_remote_tag(&repo, &remote, &tag)
}

#[tauri::command]
pub fn discard_files(path: String, files: Vec<String>) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::discard_files(&repo, &files)
}

// --- Stash ---

#[tauri::command]
pub fn list_stashes(path: String) -> AppResult<Vec<git::StashInfo>> {
    let mut repo = git::repo::open_repo(&path)?;
    git::stash::list_stashes(&mut repo)
}

#[tauri::command]
pub fn stash_save(
    path: String,
    message: Option<String>,
    include_untracked: Option<bool>,
    keep_index: Option<bool>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::stash::stash_save(
        &repo,
        message.as_deref(),
        include_untracked.unwrap_or(false),
        keep_index.unwrap_or(false),
    )
}

#[tauri::command]
pub fn stash_apply(path: String, index: usize) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::stash::stash_apply(&repo, index)
}

#[tauri::command]
pub fn stash_pop(path: String, index: usize) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::stash::stash_pop(&repo, index)
}

#[tauri::command]
pub fn stash_drop(path: String, index: usize) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::stash::stash_drop(&repo, index)
}

// --- Tags ---

#[tauri::command]
pub fn list_tags(path: String) -> AppResult<Vec<git::TagInfo>> {
    let repo = git::repo::open_repo(&path)?;
    git::tag::list_tags(&repo)
}

#[tauri::command]
pub fn create_tag(path: String, name: String, message: Option<String>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::tag::create_tag(&repo, &name, message.as_deref())
}

#[tauri::command]
pub fn delete_tag(path: String, name: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::tag::delete_tag(&repo, &name)
}

// --- Submodules ---

#[tauri::command]
pub fn list_submodules(path: String) -> AppResult<Vec<git::SubmoduleInfo>> {
    let repo = git::repo::open_repo(&path)?;
    git::submodule::list_submodules(&repo)
}

#[tauri::command]
pub fn update_submodule(path: String, name: Option<String>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::submodule::update_submodule(&repo, name.as_deref())
}

#[tauri::command]
pub fn add_submodule(
    path: String,
    url: String,
    target_path: String,
    branch: Option<String>,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::submodule::add_submodule(&repo, &url, &target_path, branch.as_deref())
}

#[tauri::command]
pub fn remove_submodule(path: String, name: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::submodule::remove_submodule(&repo, &name)
}

// --- Merge / Rebase ---

#[tauri::command]
pub fn merge_branch(
    path: String,
    branch: String,
    no_ff: Option<bool>,
) -> AppResult<git::MergeResult> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::merge_branch(&repo, &branch, no_ff.unwrap_or(false))
}

#[tauri::command]
pub fn rebase_branch(path: String, branch: String) -> AppResult<git::MergeResult> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::rebase_branch(&repo, &branch)
}

#[tauri::command]
pub fn abort_merge(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::abort_merge(&repo)
}

#[tauri::command]
pub fn abort_rebase(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::abort_rebase(&repo)
}

#[tauri::command]
pub fn continue_merge(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::continue_merge(&repo)
}

#[tauri::command]
pub fn continue_rebase(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::continue_rebase(&repo)
}

#[tauri::command]
pub fn skip_rebase(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::skip_rebase(&repo)
}

#[tauri::command]
pub fn is_merging(path: String) -> AppResult<bool> {
    let repo = git::repo::open_repo(&path)?;
    Ok(git::merge::is_merging(&repo))
}

#[tauri::command]
pub fn is_rebasing(path: String) -> AppResult<bool> {
    let repo = git::repo::open_repo(&path)?;
    Ok(git::merge::is_rebasing(&repo))
}

#[tauri::command]
pub fn resolve_ours(path: String, files: Vec<String>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::resolve_ours(&repo, &files)
}

#[tauri::command]
pub fn resolve_theirs(path: String, files: Vec<String>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::resolve_theirs(&repo, &files)
}

#[tauri::command]
pub fn list_conflicted_files(path: String) -> AppResult<Vec<String>> {
    let repo = git::repo::open_repo(&path)?;
    git::merge::list_conflicted_files(&repo)
}

#[tauri::command]
pub fn get_operation_state(path: String) -> AppResult<git::conflict::GitOperationState> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::operation_state(&repo)
}

#[tauri::command]
pub fn list_conflict_details(path: String) -> AppResult<Vec<git::conflict::ConflictFile>> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::list_conflict_details(&repo)
}

#[tauri::command]
pub fn save_conflict_resolution(path: String, file_path: String, content: String) -> AppResult<()> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::save_resolution(&repo, &file_path, &content)
}

#[tauri::command]
pub fn continue_operation(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::continue_operation(&repo)
}

#[tauri::command]
pub fn skip_operation(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::skip_operation(&repo)
}

#[tauri::command]
pub fn abort_operation(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::conflict::abort_operation(&repo)
}

// --- History (commit-level operations) ---

#[tauri::command]
pub fn checkout_commit(path: String, hash: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::history::checkout_commit(&repo, &hash)
}

#[tauri::command]
pub fn revert_commit(path: String, hash: String) -> AppResult<git::MergeResult> {
    let repo = git::repo::open_repo(&path)?;
    git::history::revert_commit(&repo, &hash)
}

#[tauri::command]
pub fn cherry_pick_commit(path: String, hash: String) -> AppResult<git::MergeResult> {
    let repo = git::repo::open_repo(&path)?;
    git::history::cherry_pick_commit(&repo, &hash)
}

#[tauri::command]
pub fn reset_to_commit(path: String, hash: String, mode: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::history::reset_to_commit(&repo, &hash, &mode)
}
