use crate::config::AppConfig;
use crate::error::AppResult;

#[tauri::command]
pub fn get_config() -> AppResult<AppConfig> {
    AppConfig::load()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> AppResult<()> {
    config.save()
}

#[tauri::command]
pub fn add_recent_repo(path: String) -> AppResult<AppConfig> {
    let mut config = AppConfig::load()?;
    config.add_recent_repo(&path);
    config.save()?;
    Ok(config)
}

/// Persist the set of currently open repo tabs and the active one.
/// Called by the frontend whenever a tab is opened, closed, or activated.
#[tauri::command]
pub fn set_open_repos(open_repos: Vec<String>, active_repo: Option<String>) -> AppResult<AppConfig> {
    let mut config = AppConfig::load()?;
    // Normalize: active_repo must be one of open_repos (or None when empty).
    let active = match active_repo {
        Some(ref p) if open_repos.iter().any(|r| r == p) => Some(p.clone()),
        _ => {
            if open_repos.is_empty() {
                None
            } else {
                Some(open_repos[0].clone())
            }
        }
    };
    config.set_open_repos(open_repos, active);
    config.save()?;
    Ok(config)
}
