use atomicwrites::{AllowOverwrite, AtomicFile};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::CredentialStore;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub ai: AiProviderConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub prompts: PromptsConfig,
    #[serde(default)]
    pub index: IndexConfig,
    #[serde(default)]
    pub recent_repos: Vec<String>,
    #[serde(default)]
    pub open_repos: Vec<String>,
    #[serde(default)]
    pub active_repo: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CredentialStatus {
    pub openai: bool,
    pub claude: bool,
    pub deepseek: bool,
    pub embedding_openai: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct IndexConfig {
    pub enabled: bool,
    pub never_upload_index: bool,
    pub embedding_provider: String,
    pub ollama_embedding_base_url: String,
    pub ollama_embedding_model: String,
    pub cloud_embedding_enabled: bool,
    pub cloud_embedding_base_url: String,
    pub cloud_embedding_model: String,
    pub extra_excludes: Vec<String>,
    pub include_untracked: bool,
    pub max_file_bytes: u32,
    pub max_chunks: u32,
    pub chunk_lines: u32,
    pub chunk_overlap: u32,
    pub max_embedding_chars: u32,
    pub top_k: u32,
    pub max_context_tokens: u32,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            never_upload_index: true,
            embedding_provider: "ollama".into(),
            ollama_embedding_base_url: "http://localhost:11434".into(),
            ollama_embedding_model: "nomic-embed-text".into(),
            cloud_embedding_enabled: false,
            cloud_embedding_base_url: "https://api.openai.com/v1".into(),
            cloud_embedding_model: "text-embedding-3-small".into(),
            extra_excludes: vec!["*.min.js".into(), "*.map".into(), "*.lock".into()],
            include_untracked: true,
            max_file_bytes: 512 * 1024,
            max_chunks: 20_000,
            chunk_lines: 120,
            chunk_overlap: 20,
            max_embedding_chars: 12_000,
            top_k: 6,
            max_context_tokens: 8_000,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptsConfig {
    #[serde(default)]
    pub commit_message: String,
    #[serde(default)]
    pub code_review: String,
    #[serde(default)]
    pub repo_chat: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiProviderConfig {
    pub active_provider: String,
    pub openai_model: String,
    pub openai_base_url: String,
    pub claude_model: String,
    pub claude_base_url: String,
    pub deepseek_model: String,
    pub deepseek_base_url: String,
    pub ollama_base_url: String,
    pub ollama_model: String,
    pub temperature: f64,
    pub max_tokens: u32,
    /// Model context window in tokens. Inputs (system prompt + messages) are
    /// automatically truncated to this minus `max_tokens` before sending, so
    /// oversized diffs/attachments no longer fail upstream with HTTP 400.
    pub max_context_tokens: u32,
    #[serde(default)]
    pub credential_status: CredentialStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: String,
    pub font_size: u32,
    pub show_diff_inline: bool,
    #[serde(default = "default_language")]
    pub language: String,
    /// Remember open repository tabs across restarts. Defaults to true for
    /// configs written before this switch existed.
    #[serde(default = "default_true")]
    pub remember_open_repos: bool,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyAiSecrets {
    #[serde(default)]
    openai_api_key: String,
    #[serde(default)]
    claude_api_key: String,
    #[serde(default)]
    deepseek_api_key: String,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyConfigSecrets {
    #[serde(default)]
    ai: LegacyAiSecrets,
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for AiProviderConfig {
    fn default() -> Self {
        Self {
            active_provider: "openai".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            openai_base_url: "https://api.openai.com/v1".to_string(),
            claude_model: "claude-sonnet-4-20250514".to_string(),
            claude_base_url: "https://api.anthropic.com/v1".to_string(),
            deepseek_model: "deepseek-chat".to_string(),
            deepseek_base_url: "https://api.deepseek.com/v1".to_string(),
            ollama_base_url: "http://localhost:11434".to_string(),
            ollama_model: "qwen2.5-coder:7b".to_string(),
            temperature: 0.7,
            max_tokens: 2048,
            max_context_tokens: 131_072,
            credential_status: CredentialStatus::default(),
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            font_size: 14,
            show_diff_inline: true,
            language: default_language(),
            remember_open_repos: true,
        }
    }
}

impl AppConfig {
    fn config_path() -> AppResult<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| AppError::Config("Cannot determine config directory".to_string()))?;
        Self::config_path_in(&config_dir.join("aigit"))
    }

    fn config_path_in(app_dir: &Path) -> AppResult<PathBuf> {
        fs::create_dir_all(app_dir)
            .map_err(|error| AppError::Config(format!("Failed to create config dir: {error}")))?;
        Ok(app_dir.join("config.toml"))
    }

    pub fn load(store: &dyn CredentialStore) -> AppResult<Self> {
        let path = Self::config_path()?;
        Self::load_from(&path, store)
    }

    fn load_from(path: &Path, store: &dyn CredentialStore) -> AppResult<Self> {
        if !path.exists() {
            let mut config = Self::default();
            config.refresh_credential_status(store)?;
            config.save_to(path)?;
            return Ok(config);
        }

        let content = fs::read_to_string(path)
            .map_err(|error| AppError::Config(format!("Failed to read config: {error}")))?;
        let mut config: Self = toml::from_str(&content)
            .map_err(|error| AppError::Config(format!("Failed to parse config: {error}")))?;
        let legacy: LegacyConfigSecrets = toml::from_str(&content).map_err(|error| {
            AppError::Config(format!("Failed to inspect legacy config: {error}"))
        })?;
        config.validate()?;

        let migrated = migrate_legacy_secrets(&legacy.ai, store)?;
        config.refresh_credential_status(store)?;
        if migrated {
            config.save_to(path)?;
        }
        Ok(config)
    }

    pub fn save(&self) -> AppResult<()> {
        self.validate()?;
        let path = Self::config_path()?;
        self.save_to(&path)
    }

    pub fn validate(&self) -> AppResult<()> {
        for (name, endpoint) in [
            ("OpenAI endpoint", self.ai.openai_base_url.as_str()),
            ("Claude endpoint", self.ai.claude_base_url.as_str()),
            ("DeepSeek endpoint", self.ai.deepseek_base_url.as_str()),
            ("Ollama endpoint", self.ai.ollama_base_url.as_str()),
            (
                "Ollama embedding endpoint",
                self.index.ollama_embedding_base_url.as_str(),
            ),
            (
                "Cloud embedding endpoint",
                self.index.cloud_embedding_base_url.as_str(),
            ),
        ] {
            validate_endpoint(endpoint, name)?;
        }
        if !(4_096..=2_097_152).contains(&self.ai.max_context_tokens) {
            return Err(AppError::Config(
                "max_context_tokens must be between 4096 and 2097152".into(),
            ));
        }
        Ok(())
    }

    fn save_to(&self, path: &Path) -> AppResult<()> {
        let mut persisted = self.clone();
        persisted.ai.credential_status = CredentialStatus::default();
        let mut value = toml::Value::try_from(persisted)
            .map_err(|error| AppError::Config(format!("Failed to serialize config: {error}")))?;
        if let Some(ai) = value.get_mut("ai").and_then(toml::Value::as_table_mut) {
            ai.remove("credential_status");
        }
        let content = toml::to_string_pretty(&value)
            .map_err(|error| AppError::Config(format!("Failed to serialize config: {error}")))?;
        let file = AtomicFile::new(path, AllowOverwrite);
        file.write(|handle| {
            handle.write_all(content.as_bytes())?;
            handle.flush()?;
            handle.sync_all()
        })
        .map_err(|error| AppError::Config(format!("Failed to atomically write config: {error}")))
    }

    pub fn refresh_credential_status(&mut self, store: &dyn CredentialStore) -> AppResult<()> {
        self.ai.credential_status = CredentialStatus {
            openai: store.get("openai")?.is_some(),
            claude: store.get("claude")?.is_some(),
            deepseek: store.get("deepseek")?.is_some(),
            embedding_openai: store.get("embedding_openai")?.is_some(),
        };
        Ok(())
    }

    pub fn add_recent_repo(&mut self, path: &str) {
        self.recent_repos.retain(|value| value != path);
        self.recent_repos.insert(0, path.to_string());
        if self.recent_repos.len() > 10 {
            self.recent_repos.truncate(10);
        }
    }

    pub fn set_open_repos(&mut self, open_repos: Vec<String>, active_repo: Option<String>) {
        self.open_repos = open_repos;
        self.active_repo = active_repo;
    }
}

fn validate_endpoint(value: &str, name: &str) -> AppResult<()> {
    const MAX_ENDPOINT_LEN: usize = 2048;
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_ENDPOINT_LEN || value.contains(['\0', '\r', '\n']) {
        return Err(AppError::Config(format!("{name} is empty or too long")));
    }
    let url = Url::parse(value)
        .map_err(|_| AppError::Config(format!("{name} must be a valid HTTP(S) URL")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Config(format!("{name} must use HTTP or HTTPS")));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Config(format!("{name} must include a host")))?;
    if url.scheme() == "http" && !is_loopback_host(host) {
        return Err(AppError::Config(format!(
            "{name} must use HTTPS unless it targets localhost"
        )));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Config(format!(
            "{name} must not embed credentials"
        )));
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn migrate_legacy_secrets(
    legacy: &LegacyAiSecrets,
    store: &dyn CredentialStore,
) -> AppResult<bool> {
    // Without a real secure store, retain legacy values rather than deleting
    // the only copy. On Windows, an existing keyring value always wins.
    if !store.is_available() {
        return Ok(false);
    }

    let secrets = [
        ("openai", legacy.openai_api_key.as_str()),
        ("claude", legacy.claude_api_key.as_str()),
        ("deepseek", legacy.deepseek_api_key.as_str()),
    ];
    let mut migrated = false;

    for (provider, secret) in secrets {
        if secret.trim().is_empty() {
            continue;
        }
        if store.get(provider)?.is_none() {
            store.set(provider, secret)?;
        }
        // The keyring value is now authoritative, whether it pre-existed or
        // was just written, so the plaintext legacy field can be removed.
        migrated = true;
    }
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::credentials::tests::MemoryCredentialStore;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("aigit-{name}-{unique}.toml"))
    }

    #[test]
    fn endpoint_validation_requires_https_except_for_loopback_services() {
        assert!(validate_endpoint("https://api.example.test/v1", "endpoint").is_ok());
        assert!(validate_endpoint("http://localhost:11434", "endpoint").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:11434", "endpoint").is_ok());
        assert!(validate_endpoint("http://[::1]:11434", "endpoint").is_ok());
        assert!(validate_endpoint("http://api.example.test/v1", "endpoint").is_err());
        assert!(validate_endpoint("https://user:secret@example.test/v1", "endpoint").is_err());
    }

    #[test]
    fn load_rejects_persisted_insecure_remote_endpoints() {
        let path = test_path("insecure-endpoint");
        fs::write(
            &path,
            "[ai]\nopenai_base_url = \"http://api.example.test/v1\"\n",
        )
        .expect("write insecure config");
        let store = MemoryCredentialStore::default();

        assert!(AppConfig::load_from(&path, &store).is_err());
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("http://api.example.test/v1"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn remember_open_repos_defaults_true_for_older_configs() {
        let path = test_path("remember-open-repos-default");
        fs::write(
            &path,
            "[ui]\ntheme = \"dark\"\nfont_size = 14\nshow_diff_inline = true\n",
        )
        .expect("write legacy config");
        let store = MemoryCredentialStore::default();

        let config = AppConfig::load_from(&path, &store).expect("load legacy config");
        assert!(config.ui.remember_open_repos);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn remember_open_repos_round_trips_explicit_false() {
        let path = test_path("remember-open-repos-off");
        fs::write(
            &path,
            "[ui]\ntheme = \"dark\"\nfont_size = 14\nshow_diff_inline = true\nremember_open_repos = false\n",
        )
        .expect("write config");
        let store = MemoryCredentialStore::default();

        let config = AppConfig::load_from(&path, &store).expect("load config");
        assert!(!config.ui.remember_open_repos);
        config.save_to(&path).expect("save config");
        let reloaded = AppConfig::load_from(&path, &store).expect("reload config");
        assert!(!reloaded.ui.remember_open_repos);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn migrates_legacy_keys_then_removes_plaintext() {
        let path = test_path("migration");
        fs::write(
            &path,
            r#"
[ai]
active_provider = "openai"
openai_api_key = "legacy-openai-secret"
openai_model = "gpt-test"
openai_base_url = "https://example.test/v1"
claude_api_key = ""
claude_model = "claude-test"
claude_base_url = "https://claude.test/v1"
deepseek_api_key = "legacy-deepseek-secret"
deepseek_model = "deepseek-test"
deepseek_base_url = "https://deepseek.test/v1"
ollama_base_url = "http://localhost:11434"
ollama_model = "ollama-test"
temperature = 0.5
max_tokens = 1024
"#,
        )
        .expect("write legacy config");
        let store = MemoryCredentialStore::default();

        let config = AppConfig::load_from(&path, &store).expect("load and migrate");
        let saved = fs::read_to_string(&path).expect("read migrated config");

        assert!(config.ai.credential_status.openai);
        assert!(config.ai.credential_status.deepseek);
        assert_eq!(
            store.get("openai").unwrap().as_deref(),
            Some("legacy-openai-secret")
        );
        assert!(!saved.contains("legacy-openai-secret"));
        assert!(!saved.contains("openai_api_key"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn existing_keyring_secret_wins_migration_conflict() {
        let path = test_path("migration-conflict");
        fs::write(&path, "[ai]\nopenai_api_key = \"legacy-secret\"\n")
            .expect("write legacy config");
        let store = MemoryCredentialStore::default();
        store.set("openai", "existing-keyring-secret").unwrap();

        let config = AppConfig::load_from(&path, &store).expect("load and resolve conflict");
        let saved = fs::read_to_string(&path).expect("read migrated config");

        assert!(config.ai.credential_status.openai);
        assert_eq!(
            store.get("openai").unwrap().as_deref(),
            Some("existing-keyring-secret")
        );
        assert!(!saved.contains("legacy-secret"));
        assert!(!saved.contains("openai_api_key"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn unavailable_secure_store_keeps_config_usable_and_legacy_secret_intact() {
        let path = test_path("migration-unavailable");
        fs::write(&path, "[ai]\nopenai_api_key = \"must-remain\"\n").expect("write legacy config");
        let store = MemoryCredentialStore::unavailable();

        let config = AppConfig::load_from(&path, &store).expect("load without keyring");

        assert!(!config.ai.credential_status.openai);
        assert!(fs::read_to_string(&path).unwrap().contains("must-remain"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn keeps_legacy_plaintext_when_keyring_write_fails() {
        let path = test_path("migration-failure");
        fs::write(
            &path,
            r#"
[ai]
openai_api_key = "must-remain"
"#,
        )
        .expect("write legacy config");
        let store = MemoryCredentialStore::failing();

        assert!(AppConfig::load_from(&path, &store).is_err());
        assert!(fs::read_to_string(&path).unwrap().contains("must-remain"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_config_is_reported_without_overwriting_it() {
        let path = test_path("malformed");
        let original = b"[ai\nopenai_api_key = \"must-not-be-lost\"\n";
        fs::write(&path, original).expect("write malformed config");
        let store = MemoryCredentialStore::default();

        let error = AppConfig::load_from(&path, &store).expect_err("malformed config must fail");

        assert!(error.to_string().contains("Failed to parse config"));
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(store.get("openai").unwrap().is_none());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn refreshes_all_credential_statuses_and_propagates_read_failures() {
        let store = MemoryCredentialStore::default();
        store.set("openai", "one").unwrap();
        store.set("embedding_openai", "embedding").unwrap();
        let mut config = AppConfig::default();

        config.refresh_credential_status(&store).unwrap();

        assert!(config.ai.credential_status.openai);
        assert!(!config.ai.credential_status.claude);
        assert!(!config.ai.credential_status.deepseek);
        assert!(config.ai.credential_status.embedding_openai);
    }

    #[test]
    fn serializes_credential_status_for_command_responses() {
        let mut config = AppConfig::default();
        config.ai.credential_status.openai = true;
        config.ai.credential_status.deepseek = true;

        let value = serde_json::to_value(&config).expect("serialize command response");
        let status = &value["ai"]["credential_status"];

        assert_eq!(status["openai"], true);
        assert_eq!(status["claude"], false);
        assert_eq!(status["deepseek"], true);
        assert_eq!(status["embedding_openai"], false);
    }

    #[test]
    fn defaults_context_window_and_validates_its_range() {
        let config = AppConfig::default();
        assert_eq!(config.ai.max_context_tokens, 131_072);

        let mut below = AppConfig::default();
        below.ai.max_context_tokens = 1_000;
        assert!(below.validate().is_err());

        let mut above = AppConfig::default();
        above.ai.max_context_tokens = 3_000_000;
        assert!(above.validate().is_err());

        config.validate().expect("default context window must validate");
    }

    #[test]
    fn saved_config_never_contains_credentials() {
        let path = test_path("atomic-save");
        let mut config = AppConfig::default();
        config.ai.credential_status.openai = true;
        config.save_to(&path).expect("save config");
        let saved = fs::read_to_string(&path).expect("read config");

        assert!(!saved.contains("api_key"));
        assert!(!saved.contains("credential_status"));
        assert!(toml::from_str::<AppConfig>(&saved).is_ok());
        let _ = fs::remove_file(path);
    }
}
