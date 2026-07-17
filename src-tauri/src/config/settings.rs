use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub ai: AiProviderConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub prompts: PromptsConfig,
    #[serde(default)]
    pub recent_repos: Vec<String>,
}

/// User-customizable AI system prompts.
/// Empty string means "use the built-in default".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptsConfig {
    #[serde(default)]
    pub commit_message: String,
    #[serde(default)]
    pub code_review: String,
    #[serde(default)]
    pub repo_chat: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProviderConfig {
    pub active_provider: String,
    pub openai_api_key: String,
    pub openai_model: String,
    pub openai_base_url: String,
    pub claude_api_key: String,
    pub claude_model: String,
    pub claude_base_url: String,
    pub deepseek_api_key: String,
    pub deepseek_model: String,
    pub deepseek_base_url: String,
    pub ollama_base_url: String,
    pub ollama_model: String,
    pub temperature: f64,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: String,
    pub font_size: u32,
    pub show_diff_inline: bool,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "zh".to_string()
}

impl Default for AiProviderConfig {
    fn default() -> Self {
        Self {
            active_provider: "openai".to_string(),
            openai_api_key: String::new(),
            openai_model: "gpt-4o-mini".to_string(),
            openai_base_url: "https://api.openai.com/v1".to_string(),
            claude_api_key: String::new(),
            claude_model: "claude-sonnet-4-20250514".to_string(),
            claude_base_url: "https://api.anthropic.com/v1".to_string(),
            deepseek_api_key: String::new(),
            deepseek_model: "deepseek-chat".to_string(),
            deepseek_base_url: "https://api.deepseek.com/v1".to_string(),
            ollama_base_url: "http://localhost:11434".to_string(),
            ollama_model: "qwen2.5-coder:7b".to_string(),
            temperature: 0.7,
            max_tokens: 2048,
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
        }
    }
}

impl Default for PromptsConfig {
    fn default() -> Self {
        Self {
            commit_message: String::new(),
            code_review: String::new(),
            repo_chat: String::new(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ai: AiProviderConfig::default(),
            ui: UiConfig::default(),
            prompts: PromptsConfig::default(),
            recent_repos: Vec::new(),
        }
    }
}

impl AppConfig {
    fn config_path() -> AppResult<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| AppError::Config("Cannot determine config directory".to_string()))?;
        let app_dir = config_dir.join("aigit");
        if !app_dir.exists() {
            fs::create_dir_all(&app_dir)
                .map_err(|e| AppError::Config(format!("Failed to create config dir: {e}")))?;
        }
        Ok(app_dir.join("config.toml"))
    }

    pub fn load() -> AppResult<Self> {
        let path = Self::config_path()?;
        if !path.exists() {
            let config = Self::default();
            config.save()?;
            return Ok(config);
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("Failed to read config: {e}")))?;
        let config: Self = toml::from_str(&content)
            .map_err(|e| AppError::Config(format!("Failed to parse config: {e}")))?;
        Ok(config)
    }

    pub fn save(&self) -> AppResult<()> {
        let path = Self::config_path()?;
        let content = toml::to_string_pretty(self)
            .map_err(|e| AppError::Config(format!("Failed to serialize config: {e}")))?;
        fs::write(&path, content)
            .map_err(|e| AppError::Config(format!("Failed to write config: {e}")))?;
        Ok(())
    }

    pub fn add_recent_repo(&mut self, path: &str) {
        self.recent_repos.retain(|p| p != path);
        self.recent_repos.insert(0, path.to_string());
        if self.recent_repos.len() > 10 {
            self.recent_repos.truncate(10);
        }
    }
}
