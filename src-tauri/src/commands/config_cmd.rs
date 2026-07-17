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
