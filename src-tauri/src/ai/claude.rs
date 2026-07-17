use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use crate::ai::{AiProvider, ChatMessage};
use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

pub struct ClaudeProvider;

#[async_trait]
impl AiProvider for ClaudeProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
    ) -> AppResult<String> {
        if config.claude_api_key.is_empty() {
            return Err(AppError::Ai(
                "API key not configured for claude provider".to_string(),
            ));
        }

        let mut api_messages = Vec::new();
        for msg in messages {
            api_messages.push(json!({
                "role": msg.role,
                "content": msg.content
            }));
        }

        let body = json!({
            "model": config.claude_model,
            "system": system_prompt,
            "messages": api_messages,
            "max_tokens": config.max_tokens,
            "stream": false
        });

        let url = format!(
            "{}/messages",
            config.claude_base_url.trim_end_matches('/')
        );
        let client = Client::new();

        let resp = client
            .post(&url)
            .header("x-api-key", &config.claude_api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Claude API request failed: {error_text}")));
        }

        let resp_json: serde_json::Value = resp.json().await?;
        let content = resp_json["content"][0]["text"]
            .as_str()
            .ok_or_else(|| AppError::Ai("Invalid Claude API response format".to_string()))?;

        Ok(content.to_string())
    }

    fn name(&self) -> &str {
        "claude"
    }
}
