pub mod claude;
pub mod ollama;
pub mod openai;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
    ) -> AppResult<String>;

    #[allow(dead_code)]
    fn name(&self) -> &str;
}

pub fn get_provider(provider_name: &str) -> AppResult<Box<dyn AiProvider>> {
    match provider_name {
        "openai" | "deepseek" => Ok(Box::new(openai::OpenAiProvider)),
        "claude" => Ok(Box::new(claude::ClaudeProvider)),
        "ollama" => Ok(Box::new(ollama::OllamaProvider)),
        other => Err(AppError::Ai(format!(
            "Unknown provider: {other}. Supported: openai, claude, deepseek, ollama"
        ))),
    }
}
