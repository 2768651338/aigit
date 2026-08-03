use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::ai::stream::SseDecoder;
use crate::ai::{
    http_client, prepare_input, read_json_limited, upstream_error, AiProvider, CancellationToken,
    ChatMessage, ProviderEvent, ProviderEventSink, StreamFuture, MAX_RESPONSE_BYTES,
};
use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct OpenAiProvider {
    client: Option<reqwest::Client>,
}

impl OpenAiProvider {
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
impl AiProvider for OpenAiProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
        api_key: Option<&str>,
    ) -> AppResult<String> {
        let api_key = api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::AiAuthentication(format!(
                    "API key not configured for {} provider",
                    config.active_provider
                ))
            })?;
        let prepared = prepare_input(system_prompt, messages, config);
        let system_prompt = &prepared.system_prompt;
        let messages = &prepared.messages;
        let (model, base_url) = if config.active_provider == "deepseek" {
            (&config.deepseek_model, &config.deepseek_base_url)
        } else {
            (&config.openai_model, &config.openai_base_url)
        };

        let mut all_messages = vec![json!({ "role": "system", "content": system_prompt })];
        for message in messages {
            all_messages.push(json!({ "role": message.role, "content": message.content }));
        }
        let body = json!({
            "model": model,
            "messages": all_messages,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "stream": false
        });
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let response = self
            .client()?
            .post(url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(upstream_error(&config.active_provider, response).await);
        }
        let response_json = read_json_limited(response).await?;
        response_json["choices"][0]["message"]["content"]
            .as_str()
            .map(ToString::to_string)
            .ok_or_else(|| AppError::AiResponse("Invalid OpenAI-compatible response format".into()))
    }

    fn stream_chat<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a [ChatMessage],
        config: &'a AiProviderConfig,
        api_key: Option<&'a str>,
        cancellation: CancellationToken,
        mut emit: ProviderEventSink<'a>,
    ) -> StreamFuture<'a> {
        Box::pin(async move {
            let api_key = api_key
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::AiAuthentication(format!(
                        "API key not configured for {} provider",
                        config.active_provider
                    ))
                })?;
            let prepared = prepare_input(system_prompt, messages, config);
            let system_prompt = &prepared.system_prompt;
            let messages = &prepared.messages;
            let (model, base_url) = if config.active_provider == "deepseek" {
                (&config.deepseek_model, &config.deepseek_base_url)
            } else {
                (&config.openai_model, &config.openai_base_url)
            };
            let mut all_messages = vec![json!({ "role": "system", "content": system_prompt })];
            for message in messages {
                all_messages.push(json!({ "role": message.role, "content": message.content }));
            }
            let body = json!({
                "model": model,
                "messages": all_messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
                "stream": true,
                "stream_options": { "include_usage": true }
            });
            let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
            let response = tokio::select! {
                _ = cancellation.cancelled() => return Err(AppError::Ai("AI request cancelled".into())),
                response = self.client()?.post(url).bearer_auth(api_key).json(&body).send() => response?,
            };
            if !response.status().is_success() {
                return Err(upstream_error(&config.active_provider, response).await);
            }

            let mut parser = SseDecoder::default();
            let mut stream = response.bytes_stream();
            let mut received = 0usize;
            let mut pending = String::new();
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
                for frame in parser.push(&chunk)? {
                    completed |= parse_openai_frame(&frame.data, &mut pending, &mut emit)?;
                }
            }
            for frame in parser.finish()? {
                completed |= parse_openai_frame(&frame.data, &mut pending, &mut emit)?;
            }
            if !pending.is_empty() {
                return Err(AppError::AiResponse(
                    "OpenAI-compatible stream ended with incomplete JSON".into(),
                ));
            }
            if !completed {
                return Err(AppError::AiResponse(
                    "OpenAI-compatible stream ended before [DONE]".into(),
                ));
            }
            Ok(())
        })
    }

    fn name(&self) -> &str {
        "openai"
    }
}

fn parse_openai_frame<F>(data: &str, pending: &mut String, emit: &mut F) -> AppResult<bool>
where
    F: FnMut(ProviderEvent) -> AppResult<()> + Send + ?Sized,
{
    if data.trim().is_empty() {
        return Ok(false);
    }
    if data.trim() == "[DONE]" {
        return Ok(true);
    }
    pending.push_str(data);
    let value: Value = match serde_json::from_str(pending) {
        Ok(value) => value,
        Err(error) if error.is_eof() => return Ok(false),
        Err(_) => {
            return Err(AppError::AiResponse(
                "Invalid OpenAI-compatible SSE data".into(),
            ))
        }
    };
    pending.clear();
    if let Some(delta) = value["choices"][0]["delta"]["content"].as_str() {
        if !delta.is_empty() {
            emit(ProviderEvent::Delta(delta.to_string()))?;
        }
    }
    if let Some(usage) = value.get("usage") {
        emit(ProviderEvent::Usage {
            input_tokens: usage["prompt_tokens"].as_u64(),
            output_tokens: usage["completion_tokens"].as_u64(),
        })?;
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::isolated_http_client;
    use crate::ai::test_support::{streaming_server, TEST_TIMEOUT};
    use std::time::Duration;

    async fn run_stream(
        provider_name: &str,
        chunks: Vec<(Duration, Vec<u8>)>,
        complete: bool,
        cancellation: CancellationToken,
    ) -> (AppResult<()>, Vec<ProviderEvent>, Vec<u8>) {
        let server = streaming_server("text/event-stream", chunks, complete).await;
        let mut config = AiProviderConfig {
            active_provider: provider_name.to_string(),
            ..AiProviderConfig::default()
        };
        if provider_name == "deepseek" {
            config.deepseek_base_url = server.base_url.clone();
        } else {
            config.openai_base_url = server.base_url.clone();
        }
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "hello".into(),
        }];
        let mut events = Vec::new();
        let mut sink = |event| {
            events.push(event);
            Ok(())
        };
        let provider = OpenAiProvider::with_client(isolated_http_client());
        let result = tokio::time::timeout(
            TEST_TIMEOUT,
            provider.stream_chat(
                "system",
                &messages,
                &config,
                Some("test-key"),
                cancellation,
                &mut sink,
            ),
        )
        .await
        .expect("OpenAI-compatible stream test timed out");
        (result, events, server.finish().await)
    }

    #[test]
    fn parses_delta_and_usage_frames() {
        let mut events = Vec::new();
        let mut sink = |event| {
            events.push(event);
            Ok(())
        };
        let mut pending = String::new();
        parse_openai_frame(
            r#"{"choices":[{"delta":{"content":"hello"}}]}"#,
            &mut pending,
            &mut sink,
        )
        .unwrap();
        parse_openai_frame(
            r#"{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}"#,
            &mut pending,
            &mut sink,
        )
        .unwrap();
        assert_eq!(events[0], ProviderEvent::Delta("hello".into()));
        assert_eq!(
            events[1],
            ProviderEvent::Usage {
                input_tokens: Some(3),
                output_tokens: Some(2)
            }
        );
    }

    #[tokio::test]
    async fn openai_and_deepseek_parse_network_streams() {
        for provider in ["openai", "deepseek"] {
            let chunks = vec![
                (
                    Duration::ZERO,
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n".to_vec(),
                ),
                (
                    Duration::from_millis(5),
                    b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n".to_vec(),
                ),
            ];
            let (result, events, request) =
                run_stream(provider, chunks, true, CancellationToken::default()).await;
            result.unwrap();
            assert_eq!(events[0], ProviderEvent::Delta("hello".into()));
            let request = String::from_utf8_lossy(&request);
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key"));
        }
    }

    #[tokio::test]
    async fn reports_truncated_stream_and_honors_cancellation() {
        let truncated = vec![(Duration::ZERO, b"data: {\"choices\":[\n\n".to_vec())];
        let (result, _, _) =
            run_stream("openai", truncated, false, CancellationToken::default()).await;
        assert!(result.unwrap_err().to_string().contains("incomplete JSON"));

        let token = CancellationToken::default();
        let cancel = token.clone();
        let cancel_task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.cancel();
        });
        let delayed = vec![(Duration::from_secs(1), b"data: [DONE]\n\n".to_vec())];
        let (result, _, _) = run_stream("deepseek", delayed, true, token).await;
        cancel_task.await.unwrap();
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
