use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use crate::ai::{AiProvider, ChatMessage};
use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

pub struct OllamaProvider;

#[async_trait]
impl AiProvider for OllamaProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
    ) -> AppResult<String> {
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
            "model": config.ollama_model,
            "messages": all_messages,
            "stream": false,
            "options": {
                "temperature": config.temperature
            }
        });

        let url = format!("{}/api/chat", config.ollama_base_url.trim_end_matches('/'));
        let client = Client::new();

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                return Err(AppError::Ai(format!(
                    "Cannot connect to Ollama at {}. Is Ollama running? Error: {e}",
                    config.ollama_base_url
                )));
            }
        };

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Ollama API request failed: {error_text}")));
        }

        let resp_json: serde_json::Value = resp.json().await?;
        let content = resp_json["message"]["content"]
            .as_str()
            .ok_or_else(|| AppError::Ai("Invalid Ollama API response format".to_string()))?;

        Ok(content.to_string())
    }

    fn name(&self) -> &str {
        "ollama"
    }
}
