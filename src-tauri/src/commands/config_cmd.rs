use std::sync::Mutex;

use crate::config::{
    AppConfig, CredentialStore, ModelProfile, SystemCredentialStore, MAX_PROFILES,
};
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
    // The active profile is authoritative for the `ai` fields, so a frontend
    // snapshot that drifted from it is reconciled before validation.
    config.materialize_active_profile();
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

/// Parse and canonicalize a caller-supplied profile id, so downstream
/// credential entry names always use the hyphenated uuid form.
fn validate_profile_id(id: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(id)
        .map(|uuid| uuid.to_string())
        .map_err(|_| AppError::Config("Model profile id must be a UUID".into()))
}

/// Activate a saved profile: its values are materialized into `ai` and
/// persisted, so the next AI request already uses it.
#[tauri::command]
pub fn switch_model_profile(profile_id: String) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    if !config.profiles.iter().any(|p| p.id == profile_id) {
        return Err(AppError::Config(format!(
            "Model profile not found: {profile_id}"
        )));
    }
    config.ai.active_profile_id = Some(profile_id);
    config.materialize_active_profile();
    config.save()?;
    Ok(config)
}

/// Create or update a profile. A non-empty `api_key` is stored under the
/// profile's own credential entry (`profile.<id>`); omit it to keep whatever
/// key state the profile already has.
#[tauri::command]
pub fn upsert_model_profile(
    mut profile: ModelProfile,
    api_key: Option<String>,
) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
    profile.name = profile.name.trim().to_string();
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
    }
    // Canonicalize so credential entry names stay uniform (`profile.<hyphenated uuid>`)
    // instead of echoing whatever uuid spelling the caller sent.
    profile.id = validate_profile_id(&profile.id)?;
    profile.validate()?;

    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    let is_new = !config.profiles.iter().any(|p| p.id == profile.id);
    // Reject over-quota creation before touching the credential store, so a
    // failed upsert never leaves an orphan keyring entry behind.
    if is_new && config.profiles.len() >= MAX_PROFILES {
        return Err(AppError::Config(format!(
            "At most {MAX_PROFILES} model profiles can be saved"
        )));
    }

    if let Some(key) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        store.set(&ModelProfile::key_entry(&profile.id), key)?;
        profile.has_own_key = true;
    }

    if is_new {
        config.profiles.push(profile.clone());
    } else {
        let slot = config
            .profiles
            .iter_mut()
            .find(|p| p.id == profile.id)
            .expect("profile existence checked above");
        *slot = profile.clone();
    }
    // Editing the active profile takes effect immediately after the save.
    if config.ai.active_profile_id.as_deref() == Some(profile.id.as_str()) {
        config.materialize_active_profile();
    }
    config.save()?;
    Ok(config)
}

#[tauri::command]
pub fn delete_model_profile(profile_id: String) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    if config.profiles.len() <= 1 {
        return Err(AppError::Config(
            "At least one model profile must remain".into(),
        ));
    }
    if config.ai.active_profile_id.as_deref() == Some(profile_id.as_str()) {
        return Err(AppError::Config(
            "Cannot delete the active model profile; switch to another one first".into(),
        ));
    }
    let before = config.profiles.len();
    config.profiles.retain(|p| p.id != profile_id);
    if config.profiles.len() == before {
        return Err(AppError::Config(format!(
            "Model profile not found: {profile_id}"
        )));
    }
    // Tolerates a missing entry; only real keyring failures surface here.
    store.delete(&ModelProfile::key_entry(&profile_id))?;
    config.save()?;
    Ok(config)
}

/// Clone a profile (including its stored API key, if any) under a new name.
/// The duplicate never becomes the active profile.
#[tauri::command]
pub fn duplicate_model_profile(profile_id: String, new_name: String) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() || new_name.chars().count() > 64 {
        return Err(AppError::Config(
            "Profile name must be 1-64 characters".into(),
        ));
    }
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    if config.profiles.len() >= MAX_PROFILES {
        return Err(AppError::Config(format!(
            "At most {MAX_PROFILES} model profiles can be saved"
        )));
    }
    let source = config
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::Config(format!("Model profile not found: {profile_id}")))?
        .clone();
    let mut copy = source.clone();
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = new_name;
    copy.has_own_key = false;
    if source.has_own_key {
        if let Some(key) = store.get(&ModelProfile::key_entry(&source.id))? {
            store.set(&ModelProfile::key_entry(&copy.id), &key)?;
            copy.has_own_key = true;
        }
    }
    config.profiles.push(copy);
    config.save()?;
    Ok(config)
}

#[tauri::command]
pub fn delete_profile_api_key(profile_id: String) -> AppResult<AppConfig> {
    let _guard = lock_config_writes()?;
    let store = SystemCredentialStore;
    let mut config = AppConfig::load(&store)?;
    // Require an existing profile so a stray uuid can never address a
    // keyring entry that belongs to no profile.
    if !config.profiles.iter().any(|p| p.id == profile_id) {
        return Err(AppError::Config(format!(
            "Model profile not found: {profile_id}"
        )));
    }
    // Tolerates a missing entry; only real keyring failures surface here.
    store.delete(&ModelProfile::key_entry(&profile_id))?;
    if let Some(slot) = config.profiles.iter_mut().find(|p| p.id == profile_id) {
        slot.has_own_key = false;
    }
    config.save()?;
    Ok(config)
}
