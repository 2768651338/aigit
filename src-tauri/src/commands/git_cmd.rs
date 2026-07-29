use crate::error::AppResult;
use crate::git;

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
pub fn amend_message(path: String, message: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::commit::amend_message(&repo, &message)
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
pub fn push(path: String, set_upstream: Option<bool>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::push_current_branch(&repo, set_upstream.unwrap_or(false))
}

#[tauri::command]
pub fn pull(path: String) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::pull_current_branch(&repo)
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
pub fn merge_branch(path: String, branch: String, no_ff: Option<bool>) -> AppResult<git::MergeResult> {
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
