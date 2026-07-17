use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use crate::ai::{AiProvider, ChatMessage};
use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

pub struct OpenAiProvider;

#[async_trait]
impl AiProvider for OpenAiProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
    ) -> AppResult<String> {
        let (api_key, model, base_url) = if config.active_provider == "deepseek" {
            (
                &config.deepseek_api_key,
                &config.deepseek_model,
                &config.deepseek_base_url,
            )
        } else {
            (
                &config.openai_api_key,
                &config.openai_model,
                &config.openai_base_url,
            )
        };

        if api_key.is_empty() {
            return Err(AppError::Ai(format!(
                "API key not configured for {} provider",
                config.active_provider
            )));
        }

        let mut all_messages = vec![json!({
            "role": "system",
            "content": system_prompt
        })];

        for msg in messages {
            all_messages.push(json!({
                "role": msg.role,
                "content": msg.content
            }));
        }

        let body = json!({
            "model": model,
            "messages": all_messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": false
        });

        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let client = Client::new();

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!(
                "API request failed ({}): {error_text}",
                config.active_provider
            )));
        }

        let resp_json: serde_json::Value = resp.json().await?;
        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| AppError::Ai("Invalid API response format".to_string()))?;

        Ok(content.to_string())
    }

    fn name(&self) -> &str {
        "openai"
    }
}
