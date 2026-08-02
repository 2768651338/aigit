use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    Started {
        #[serde(rename = "requestId")]
        request_id: String,
        provider: String,
        streaming: bool,
    },
    Delta {
        #[serde(rename = "requestId")]
        request_id: String,
        delta: String,
    },
    Usage {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "inputTokens")]
        input_tokens: Option<u64>,
        #[serde(rename = "outputTokens")]
        output_tokens: Option<u64>,
    },
    Completed {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Cancelled {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Failed {
        #[serde(rename = "requestId")]
        request_id: String,
        code: String,
        message: String,
        retryable: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderEvent {
    Delta(String),
    Usage {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
}

#[derive(Debug, Default)]
struct CancellationInner {
    cancelled: std::sync::atomic::AtomicBool,
    notify: Notify,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<CancellationInner>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0
            .cancelled
            .store(true, std::sync::atomic::Ordering::Release);
        self.0.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }

    pub async fn cancelled(&self) {
        loop {
            let notified = self.0.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Debug, Default)]
pub struct CancellationRegistry(Mutex<HashMap<String, CancellationToken>>);

impl CancellationRegistry {
    pub fn register(&self, request_id: &str) -> AppResult<CancellationToken> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| AppError::General("AI cancellation registry is unavailable".into()))?;
        if entries.contains_key(request_id) {
            return Err(AppError::Ai(format!(
                "An AI request with id {request_id} is already running"
            )));
        }
        let token = CancellationToken::default();
        entries.insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    pub fn cancel(&self, request_id: &str) -> AppResult<bool> {
        let entries = self
            .0
            .lock()
            .map_err(|_| AppError::General("AI cancellation registry is unavailable".into()))?;
        if let Some(token) = entries.get(request_id) {
            token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn remove(&self, request_id: &str) {
        if let Ok(mut entries) = self.0.lock() {
            entries.remove(request_id);
        }
    }
}

pub struct RegistrationGuard<'a> {
    registry: &'a CancellationRegistry,
    request_id: String,
}

impl<'a> RegistrationGuard<'a> {
    pub fn new(registry: &'a CancellationRegistry, request_id: &str) -> Self {
        Self {
            registry,
            request_id: request_id.to_string(),
        }
    }
}

impl Drop for RegistrationGuard<'_> {
    fn drop(&mut self) {
        self.registry.remove(&self.request_id);
    }
}

#[derive(Debug, Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SseFrame {
    pub event: Option<String>,
    pub data: String,
}

impl SseDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> AppResult<Vec<SseFrame>> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line).map_err(|_| {
                AppError::AiResponse("AI stream contained invalid UTF-8".to_string())
            })?;
            if line.is_empty() {
                if !self.data.is_empty() || self.event.is_some() {
                    frames.push(SseFrame {
                        event: self.event.take(),
                        data: std::mem::take(&mut self.data).join("\n"),
                    });
                }
            } else if let Some(value) = line.strip_prefix("event:") {
                self.event = Some(value.trim_start().to_string());
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data.push(value.trim_start().to_string());
            } else if !line.starts_with(':') {
                // Be tolerant of transport/proxy chunk boundaries that surface a
                // continuation of a data field as a physical line.
                if let Some(data) = self.data.last_mut() {
                    data.push_str(&line);
                }
            }
        }
        Ok(frames)
    }

    pub fn finish(&mut self) -> AppResult<Vec<SseFrame>> {
        if !self.buffer.is_empty() {
            self.buffer.push(b'\n');
        }
        let mut frames = self.push(&[])?;
        if !self.data.is_empty() || self.event.is_some() {
            frames.push(SseFrame {
                event: self.event.take(),
                data: std::mem::take(&mut self.data).join("\n"),
            });
        }
        Ok(frames)
    }
}

#[derive(Debug, Default)]
pub struct JsonLineDecoder {
    buffer: Vec<u8>,
}

impl JsonLineDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> AppResult<Vec<serde_json::Value>> {
        self.buffer.extend_from_slice(chunk);
        let mut values = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line = self.buffer.drain(..=index).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&line);
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                values.push(serde_json::from_str(trimmed).map_err(|_| {
                    AppError::AiResponse("Ollama returned an invalid JSONL record".to_string())
                })?);
            }
        }
        Ok(values)
    }

    pub fn finish(&mut self) -> AppResult<Vec<serde_json::Value>> {
        if self.buffer.is_empty() {
            return Ok(Vec::new());
        }
        self.buffer.push(b'\n');
        self.push(&[])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse_across_arbitrary_chunk_boundaries() {
        let mut parser = SseDecoder::default();
        assert!(parser.push(b"event: content_block_d").unwrap().is_empty());
        assert!(parser
            .push(b"elta\r\ndata: {\"delta\":{\"text\":\"")
            .unwrap()
            .is_empty());
        let frames = parser.push("你\"}}\r\n\r\n".as_bytes()).unwrap();
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("content_block_delta".into()),
                data: "{\"delta\":{\"text\":\"你\"}}".into(),
            }]
        );
    }

    #[test]
    fn parses_jsonl_with_split_multibyte_text_and_final_unterminated_line() {
        let input = "{\"message\":{\"content\":\"你好\"}}\n{\"done\":true}".as_bytes();
        let split = input.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
        let mut parser = JsonLineDecoder::default();
        assert!(parser.push(&input[..split]).unwrap().is_empty());
        let first = parser.push(&input[split..input.len() - 5]).unwrap();
        assert_eq!(first[0]["message"]["content"], "你好");
        parser.push(&input[input.len() - 5..]).unwrap();
        let final_values = parser.finish().unwrap();
        assert_eq!(final_values[0]["done"], true);
    }

    #[test]
    fn rejects_invalid_utf8_and_invalid_jsonl_without_losing_valid_records() {
        let mut sse = SseDecoder::default();
        assert!(sse
            .push(&[b'd', b'a', b't', b'a', b':', b' ', 0xff, b'\n'])
            .is_err());

        let mut jsonl = JsonLineDecoder::default();
        let error = jsonl
            .push(b"{\"ok\":true}\nnot-json\n")
            .expect_err("invalid record must fail");
        assert!(error.to_string().contains("invalid JSONL"));
    }

    #[tokio::test]
    async fn cancellation_is_sticky_and_duplicate_registration_is_rejected() {
        let token = CancellationToken::default();
        token.cancel();
        tokio::time::timeout(std::time::Duration::from_millis(50), token.cancelled())
            .await
            .expect("already-cancelled token must resolve immediately");

        let registry = CancellationRegistry::default();
        registry.register("same").unwrap();
        assert!(registry.register("same").is_err());
        assert!(!registry.cancel("missing").unwrap());
    }

    #[tokio::test]
    async fn cancellation_registry_isolated_by_request_id_and_cleans_up() {
        let registry = CancellationRegistry::default();
        let first = registry.register("first").unwrap();
        let second = registry.register("second").unwrap();
        assert!(registry.cancel("first").unwrap());
        first.cancelled().await;
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        registry.remove("first");
        assert!(!registry.cancel("first").unwrap());
        assert!(registry.register("first").is_ok());
    }
}
