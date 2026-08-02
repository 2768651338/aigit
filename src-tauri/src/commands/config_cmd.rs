use crate::config::{AppConfig, CredentialStore, SystemCredentialStore};
use crate::error::AppResult;

#[tauri::command]
pub fn get_config() -> AppResult<AppConfig> {
    AppConfig::load(&SystemCredentialStore)
}

#[tauri::command]
pub fn save_config(mut config: AppConfig) -> AppResult<AppConfig> {
    config.refresh_credential_status(&SystemCredentialStore)?;
    config.save()?;
    Ok(config)
}

#[tauri::command]
pub fn set_api_key(provider: String, api_key: String) -> AppResult<AppConfig> {
    let store = SystemCredentialStore;
    store.set(&provider, &api_key)?;
    let mut config = AppConfig::load(&store)?;
    config.refresh_credential_status(&store)?;
    Ok(config)
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> AppResult<AppConfig> {
    let store = SystemCredentialStore;
    store.delete(&provider)?;
    let mut config = AppConfig::load(&store)?;
    config.refresh_credential_status(&store)?;
    Ok(config)
}

#[tauri::command]
pub fn add_recent_repo(path: String) -> AppResult<AppConfig> {
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    config.add_recent_repo(&path);
    config.save()?;
    Ok(config)
}

#[tauri::command]
pub fn set_open_repos(
    open_repos: Vec<String>,
    active_repo: Option<String>,
) -> AppResult<AppConfig> {
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    let active = match active_repo {
        Some(ref path) if open_repos.iter().any(|repo| repo == path) => Some(path.clone()),
        _ if open_repos.is_empty() => None,
        _ => Some(open_repos[0].clone()),
    };
    config.set_open_repos(open_repos, active);
    config.save()?;
    Ok(config)
}
