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
pub struct ClaudeProvider {
    client: Option<reqwest::Client>,
}

impl ClaudeProvider {
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
impl AiProvider for ClaudeProvider {
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
                AppError::AiAuthentication("API key not configured for claude provider".to_string())
            })?;
        let prepared = prepare_input(system_prompt, messages, config);
        let system_prompt = &prepared.system_prompt;
        let messages = &prepared.messages;
        let api_messages: Vec<_> = messages
            .iter()
            .map(|message| json!({ "role": message.role, "content": message.content }))
            .collect();
        let body = json!({
            "model": config.claude_model,
            "system": system_prompt,
            "messages": api_messages,
            "max_tokens": config.max_tokens,
            "stream": false
        });
        let url = format!("{}/messages", config.claude_base_url.trim_end_matches('/'));
        let response = self
            .client()?
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(upstream_error("claude", response).await);
        }
        let response_json = read_json_limited(response).await?;
        response_json["content"][0]["text"]
            .as_str()
            .map(ToString::to_string)
            .ok_or_else(|| AppError::AiResponse("Invalid Claude response format".into()))
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
                    AppError::AiAuthentication("API key not configured for claude provider".into())
                })?;
            let prepared = prepare_input(system_prompt, messages, config);
            let system_prompt = &prepared.system_prompt;
            let messages = &prepared.messages;
            let api_messages: Vec<_> = messages
                .iter()
                .map(|message| json!({ "role": message.role, "content": message.content }))
                .collect();
            let body = json!({
                "model": config.claude_model,
                "system": system_prompt,
                "messages": api_messages,
                "max_tokens": config.max_tokens,
                "stream": true
            });
            let url = format!("{}/messages", config.claude_base_url.trim_end_matches('/'));
            let response = tokio::select! {
                _ = cancellation.cancelled() => return Err(AppError::Ai("AI request cancelled".into())),
                response = self.client()?.post(url).header("x-api-key", api_key).header("anthropic-version", "2023-06-01").json(&body).send() => response?,
            };
            if !response.status().is_success() {
                return Err(upstream_error("claude", response).await);
            }
            let mut parser = SseDecoder::default();
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
                for frame in parser.push(&chunk)? {
                    completed |= frame.event.as_deref() == Some("message_stop")
                        || serde_json::from_str::<Value>(&frame.data)
                            .ok()
                            .and_then(|value| {
                                value["type"].as_str().map(|kind| kind == "message_stop")
                            })
                            .unwrap_or(false);
                    parse_claude_frame(frame.event.as_deref(), &frame.data, &mut emit)?;
                }
            }
            for frame in parser.finish()? {
                completed |= frame.event.as_deref() == Some("message_stop")
                    || serde_json::from_str::<Value>(&frame.data)
                        .ok()
                        .and_then(|value| value["type"].as_str().map(|kind| kind == "message_stop"))
                        .unwrap_or(false);
                parse_claude_frame(frame.event.as_deref(), &frame.data, &mut emit)?;
            }
            if !completed {
                return Err(AppError::AiResponse(
                    "Claude stream ended before message_stop".into(),
                ));
            }
            Ok(())
        })
    }

    fn name(&self) -> &str {
        "claude"
    }
}

fn parse_claude_frame<F>(event: Option<&str>, data: &str, emit: &mut F) -> AppResult<()>
where
    F: FnMut(ProviderEvent) -> AppResult<()> + Send + ?Sized,
{
    if data.trim().is_empty() {
        return Ok(());
    }
    let value: Value = serde_json::from_str(data)
        .map_err(|_| AppError::AiResponse("Invalid Claude SSE data".into()))?;
    match event.or_else(|| value["type"].as_str()) {
        Some("content_block_delta") => {
            if let Some(delta) = value["delta"]["text"].as_str() {
                if !delta.is_empty() {
                    emit(ProviderEvent::Delta(delta.to_string()))?;
                }
            }
        }
        Some("message_start") => {
            if let Some(usage) = value["message"].get("usage") {
                emit(ProviderEvent::Usage {
                    input_tokens: usage["input_tokens"].as_u64(),
                    output_tokens: usage["output_tokens"].as_u64(),
                })?;
            }
        }
        Some("message_delta") => {
            if let Some(usage) = value.get("usage") {
                emit(ProviderEvent::Usage {
                    input_tokens: usage["input_tokens"].as_u64(),
                    output_tokens: usage["output_tokens"].as_u64(),
                })?;
            }
        }
        Some("error") => {
            return Err(AppError::AiUpstream(
                value["error"]["message"]
                    .as_str()
                    .unwrap_or("Claude streaming request failed")
                    .to_string(),
            ));
        }
        _ => {}
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
    fn parses_claude_content_delta() {
        let mut events = Vec::new();
        let mut sink = |event| {
            events.push(event);
            Ok(())
        };
        parse_claude_frame(
            Some("content_block_delta"),
            r#"{"delta":{"type":"text_delta","text":"hi"}}"#,
            &mut sink,
        )
        .unwrap();
        assert_eq!(events, vec![ProviderEvent::Delta("hi".into())]);
    }

    async fn run_stream(
        chunks: Vec<(Duration, Vec<u8>)>,
        complete: bool,
        token: CancellationToken,
    ) -> (AppResult<()>, Vec<ProviderEvent>) {
        let server = streaming_server("text/event-stream", chunks, complete).await;
        let config = AiProviderConfig {
            claude_base_url: server.base_url.clone(),
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
        let provider = ClaudeProvider::with_client(isolated_http_client());
        let result = tokio::time::timeout(
            TEST_TIMEOUT,
            provider.stream_chat(
                "system",
                &messages,
                &config,
                Some("test-key"),
                token,
                &mut sink,
            ),
        )
        .await
        .expect("Claude stream test timed out");
        let request = String::from_utf8_lossy(&server.finish().await).into_owned();
        assert!(request.to_ascii_lowercase().contains("x-api-key: test-key"));
        (result, events)
    }

    #[tokio::test]
    async fn parses_network_stream_and_reports_disconnect() {
        let chunks = vec![(
            Duration::ZERO,
            b"event: content_block_delta
data: {\"type\":\"message_stop\",\"delta\":{\"text\":\"hello\"}}

"
            .to_vec(),
        )];
        let (result, events) = run_stream(chunks, true, CancellationToken::default()).await;
        result.unwrap();
        assert_eq!(events, vec![ProviderEvent::Delta("hello".into())]);

        let truncated = vec![(
            Duration::ZERO,
            b"event: content_block_delta
data: {\"delta\":{\"text\":\"partial\"}}

"
            .to_vec(),
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
        let delayed = vec![(
            Duration::from_secs(1),
            b"event: message_stop\ndata: {}\n\n".to_vec(),
        )];
        let (result, _) = run_stream(delayed, true, token).await;
        cancel_task.await.unwrap();
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
