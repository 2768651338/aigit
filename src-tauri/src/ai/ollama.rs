use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::ai::stream::JsonLineDecoder;
use crate::ai::{
    http_client, prepare_input, read_json_limited, upstream_error, AiProvider, CancellationToken,
    ChatMessage, ProviderEvent, ProviderEventSink, StreamFuture, MAX_RESPONSE_BYTES,
};
use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct OllamaProvider {
    client: Option<reqwest::Client>,
}

impl OllamaProvider {
    fn client(&self) -> AppResult<&reqwest::Client> {
        match &self.client {
            Some(client) => Ok(client),
            None => http_client(),
        }
    }

    #[cfg(test)]
    fn with_client(client: reqwest::Client) -> Self {
        Self {
            client: Some(client),
        }
    }
}

#[async_trait]
impl AiProvider for OllamaProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
        _api_key: Option<&str>,
    ) -> AppResult<String> {
        let prepared = prepare_input(system_prompt, messages, config);
        let system_prompt = &prepared.system_prompt;
        let messages = &prepared.messages;
        let mut all_messages = vec![json!({ "role": "system", "content": system_prompt })];
        for message in messages {
            all_messages.push(json!({ "role": message.role, "content": message.content }));
        }
        let body = json!({
            "model": config.ollama_model,
            "messages": all_messages,
            "stream": false,
            "options": { "temperature": config.temperature }
        });
        let url = format!("{}/api/chat", config.ollama_base_url.trim_end_matches('/'));
        let response = self
            .client()?
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() || error.is_connect() {
                    AppError::Http(error)
                } else {
                    AppError::Ai("Ollama request failed before receiving a response".into())
                }
            })?;

        if !response.status().is_success() {
            return Err(upstream_error("ollama", response).await);
        }
        let response_json = read_json_limited(response).await?;
        response_json["message"]["content"]
            .as_str()
            .map(ToString::to_string)
            .ok_or_else(|| AppError::AiResponse("Invalid Ollama response format".into()))
    }

    fn stream_chat<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a [ChatMessage],
        config: &'a AiProviderConfig,
        _api_key: Option<&'a str>,
        cancellation: CancellationToken,
        mut emit: ProviderEventSink<'a>,
    ) -> StreamFuture<'a> {
        Box::pin(async move {
            let prepared = prepare_input(system_prompt, messages, config);
            let system_prompt = &prepared.system_prompt;
            let messages = &prepared.messages;
            let mut all_messages = vec![json!({ "role": "system", "content": system_prompt })];
            for message in messages {
                all_messages.push(json!({ "role": message.role, "content": message.content }));
            }
            let body = json!({
                "model": config.ollama_model,
                "messages": all_messages,
                "stream": true,
                "options": { "temperature": config.temperature }
            });
            let url = format!("{}/api/chat", config.ollama_base_url.trim_end_matches('/'));
            let response = tokio::select! {
                _ = cancellation.cancelled() => return Err(AppError::Ai("AI request cancelled".into())),
                response = self.client()?.post(url).json(&body).send() => response?,
            };
            if !response.status().is_success() {
                return Err(upstream_error("ollama", response).await);
            }
            let mut parser = JsonLineDecoder::default();
            let mut stream = response.bytes_stream();
            let mut received = 0usize;
            let mut completed = false;
            while let Some(chunk) = tokio::select! {
                _ = cancellation.cancelled() => return Err(AppError::Ai("AI request cancelled".into())),
                chunk = stream.next() => chunk,
            } {
                let chunk = chunk?;
                received = received.saturating_add(chunk.len());
                if received > MAX_RESPONSE_BYTES {
                    return Err(AppError::AiResponse(format!(
                        "AI response exceeded the {MAX_RESPONSE_BYTES} byte limit"
                    )));
                }
                for value in parser.push(&chunk)? {
                    completed |= value["done"].as_bool() == Some(true);
                    parse_ollama_record(&value, &mut emit)?;
                }
            }
            let final_values = parser.finish()?;
            for value in final_values {
                completed |= value["done"].as_bool() == Some(true);
                parse_ollama_record(&value, &mut emit)?;
            }
            if !completed {
                return Err(AppError::AiResponse(
                    "Ollama stream ended before done=true".into(),
                ));
            }
            Ok(())
        })
    }

    fn name(&self) -> &str {
        "ollama"
    }
}

fn parse_ollama_record<F>(value: &Value, emit: &mut F) -> AppResult<()>
where
    F: FnMut(ProviderEvent) -> AppResult<()> + Send + ?Sized,
{
    if let Some(error) = value["error"].as_str() {
        return Err(AppError::AiUpstream(error.to_string()));
    }
    if let Some(delta) = value["message"]["content"].as_str() {
        if !delta.is_empty() {
            emit(ProviderEvent::Delta(delta.to_string()))?;
        }
    }
    if value["done"].as_bool() == Some(true) {
        let input_tokens = value["prompt_eval_count"].as_u64();
        let output_tokens = value["eval_count"].as_u64();
        if input_tokens.is_some() || output_tokens.is_some() {
            emit(ProviderEvent::Usage {
                input_tokens,
                output_tokens,
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::isolated_http_client;
    use crate::ai::test_support::{streaming_server, TEST_TIMEOUT};
    use std::time::Duration;

    #[test]
    fn parses_ollama_delta_and_usage() {
        let mut events = Vec::new();
        let mut sink = |event| {
            events.push(event);
            Ok(())
        };
        parse_ollama_record(
            &serde_json::json!({"message":{"content":"ok"},"done":false}),
            &mut sink,
        )
        .unwrap();
        parse_ollama_record(
            &serde_json::json!({"done":true,"prompt_eval_count":4,"eval_count":1}),
            &mut sink,
        )
        .unwrap();
        assert_eq!(events[0], ProviderEvent::Delta("ok".into()));
        assert_eq!(
            events[1],
            ProviderEvent::Usage {
                input_tokens: Some(4),
                output_tokens: Some(1)
            }
        );
    }

    async fn run_stream(
        chunks: Vec<(Duration, Vec<u8>)>,
        complete: bool,
        token: CancellationToken,
    ) -> (AppResult<()>, Vec<ProviderEvent>) {
        let server = streaming_server("application/x-ndjson", chunks, complete).await;
        let config = AiProviderConfig {
            ollama_base_url: server.base_url.clone(),
            ..AiProviderConfig::default()
        };
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "hi".into(),
        }];
        let mut events = Vec::new();
        let mut sink = |event| {
            events.push(event);
            Ok(())
        };
        let provider = OllamaProvider::with_client(isolated_http_client());
        let result = tokio::time::timeout(
            TEST_TIMEOUT,
            provider.stream_chat("system", &messages, &config, None, token, &mut sink),
        )
        .await
        .expect("Ollama stream test timed out");
        let _request = server.finish().await;
        (result, events)
    }

    #[tokio::test]
    async fn parses_network_stream_and_reports_disconnect() {
        let chunks = vec![(
            Duration::ZERO,
            b"{\"message\":{\"content\":\"hello\"},\"done\":true,\"prompt_eval_count\":4,\"eval_count\":1}\n".to_vec(),
        )];
        let (result, events) = run_stream(chunks, true, CancellationToken::default()).await;
        result.unwrap();
        assert_eq!(events[0], ProviderEvent::Delta("hello".into()));

        let truncated = vec![(
            Duration::ZERO,
            b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n".to_vec(),
        )];
        let (result, _) = run_stream(truncated, false, CancellationToken::default()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn cancels_network_stream() {
        let token = CancellationToken::default();
        let cancel = token.clone();
        let cancel_task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.cancel();
        });
        let delayed = vec![(Duration::from_secs(1), b"{\"done\":true}\n".to_vec())];
        let (result, _) = run_stream(delayed, true, token).await;
        cancel_task.await.unwrap();
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
