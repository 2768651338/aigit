use std::sync::Mutex;

use crate::config::{AppConfig, CredentialStore, SystemCredentialStore};
use crate::error::{AppError, AppResult};

/// Serializes config.toml read-modify-write sequences. Tauri runs commands on
/// a thread pool, so without this lock concurrent commands (e.g. switching
/// repo tabs while a repo is opened) would each load the file, modify it and
/// save — the last writer wins and the other's update is silently lost.
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn lock_config_writes() -> AppResult<std::sync::MutexGuard<'static, ()>> {
    CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::Config("Config write lock is unavailable".into()))
}

#[tauri::command]
pub fn get_config() -> AppResult<AppConfig> {
    AppConfig::load(&SystemCredentialStore)
}

#[tauri::command]
pub fn save_config(mut config: AppConfig) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
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
    let _guard = lock_config_writes()?;
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
    let _guard = lock_config_writes()?;
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
