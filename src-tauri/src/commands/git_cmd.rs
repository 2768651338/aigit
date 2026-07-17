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
pub fn push(path: String, set_upstream: Option<bool>) -> AppResult<String> {
    let repo = git::repo::open_repo(&path)?;
    git::remote::push_current_branch(&repo, set_upstream.unwrap_or(false))
}
