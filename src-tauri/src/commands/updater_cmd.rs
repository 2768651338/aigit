use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Serialize)]
pub struct UpdaterAvailability {
    enabled: bool,
}

#[tauri::command]
pub fn updater_availability(app: tauri::AppHandle) -> AppResult<UpdaterAvailability> {
    let enabled = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .is_some_and(|endpoints| !endpoints.is_empty());
    Ok(UpdaterAvailability { enabled })
}
