use tauri::State;

use crate::code_index::{self, IndexManager, IndexStatus, SearchHit};
use crate::error::AppResult;

#[tauri::command]
pub fn get_code_index_status(
    repo_path: String,
    manager: State<'_, IndexManager>,
) -> AppResult<IndexStatus> {
    manager.status(&repo_path)
}

#[tauri::command]
pub async fn rebuild_code_index(
    repo_path: String,
    force: bool,
    manager: State<'_, IndexManager>,
) -> AppResult<IndexStatus> {
    manager.rebuild(&repo_path, force).await
}

#[tauri::command]
pub fn cancel_code_index(repo_path: String, manager: State<'_, IndexManager>) -> AppResult<bool> {
    Ok(manager.cancel(&repo_path))
}

#[tauri::command]
pub fn delete_code_index(repo_path: String, manager: State<'_, IndexManager>) -> AppResult<bool> {
    manager.delete(&repo_path)
}

#[tauri::command]
pub async fn search_code_index(
    repo_path: String,
    query: String,
    top_k: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    code_index::search(&repo_path, &query, top_k.unwrap_or(6)).await
}
