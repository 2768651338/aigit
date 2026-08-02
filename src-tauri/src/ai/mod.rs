use async_trait::async_trait;
use futures_util::StreamExt;
use regex::{Captures, Regex};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use crate::config::AiProviderConfig;
use crate::error::{AppError, AppResult};

pub mod claude;
pub mod ollama;
pub mod openai;
pub mod stream;

pub use stream::{CancellationToken, ProviderEvent};

pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub type ProviderEventSink<'a> = &'a mut (dyn FnMut(ProviderEvent) -> AppResult<()> + Send);
pub type StreamFuture<'a> = Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>>;

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
        api_key: Option<&str>,
    ) -> AppResult<String>;

    fn stream_chat<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a [ChatMessage],
        config: &'a AiProviderConfig,
        api_key: Option<&'a str>,
        cancellation: CancellationToken,
        emit: ProviderEventSink<'a>,
    ) -> StreamFuture<'a> {
        Box::pin(async move {
            if cancellation.is_cancelled() {
                return Err(AppError::Ai("AI request cancelled".into()));
            }
            let result = self.chat(system_prompt, messages, config, api_key).await?;
            if !result.is_empty() {
                emit(ProviderEvent::Delta(result))?;
            }
            Ok(())
        })
    }

    #[allow(dead_code)]
    fn name(&self) -> &str;
}

pub fn get_provider(provider_name: &str) -> AppResult<Box<dyn AiProvider>> {
    match provider_name {
        "openai" | "deepseek" => Ok(Box::new(openai::OpenAiProvider::default())),
        "claude" => Ok(Box::new(claude::ClaudeProvider::default())),
        "ollama" => Ok(Box::new(ollama::OllamaProvider::default())),
        other => Err(AppError::Ai(format!(
            "Unknown provider: {other}. Supported: openai, claude, deepseek, ollama"
        ))),
    }
}

fn build_http_client(pool_max_idle_per_host: usize) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(pool_max_idle_per_host)
        .user_agent("aigit/1")
        .build()
        .map_err(|error| error.to_string())
}

pub(crate) fn http_client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build_http_client(usize::MAX))
        .as_ref()
        .map_err(|error| AppError::Ai(format!("Cannot initialize HTTP client: {error}")))
}

#[cfg(test)]
pub(crate) fn isolated_http_client() -> Client {
    build_http_client(0).expect("test HTTP client must initialize")
}

pub(crate) async fn read_json_limited(response: Response) -> AppResult<serde_json::Value> {
    let body = read_body_limited(response, MAX_RESPONSE_BYTES).await?;
    serde_json::from_slice(&body).map_err(|_| {
        AppError::AiResponse("The AI service returned an invalid JSON response".to_string())
    })
}

pub(crate) async fn upstream_error(provider: &str, response: Response) -> AppError {
    let status = response.status();
    let body = read_body_limited(response, MAX_ERROR_BODY_BYTES)
        .await
        .unwrap_or_default();
    let detail = sanitize_error_body(&body);
    let message = if detail.is_empty() {
        format!("{provider} returned HTTP {status}")
    } else {
        format!("{provider} returned HTTP {status}: {detail}")
    };

    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppError::AiAuthentication(message),
        StatusCode::TOO_MANY_REQUESTS => AppError::AiRateLimited(message),
        status if status.is_server_error() => AppError::AiUpstream(message),
        _ => AppError::Ai(message),
    }
}

async fn read_body_limited(response: Response, limit: usize) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(AppError::AiResponse(format!(
            "AI response exceeded the {limit} byte limit"
        )));
    }

    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::AiResponse(format!(
                "AI response exceeded the {limit} byte limit"
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn sanitize_error_body(body: &[u8]) -> String {
    static URL_SENSITIVE: OnceLock<Regex> = OnceLock::new();
    static HEADER_SENSITIVE: OnceLock<Regex> = OnceLock::new();
    static KEY_VALUE_SENSITIVE: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();

    let mut text = String::from_utf8_lossy(body).into_owned();
    text = URL_SENSITIVE
        .get_or_init(|| {
            Regex::new(
                r#"(?i)([?&](?:api[_-]?key|access[_-]?token|token|key|authorization)=)[^&#\s"'<>]*"#,
            )
            .expect("valid sensitive URL regex")
        })
        .replace_all(&text, "$1[REDACTED]")
        .into_owned();
    text = HEADER_SENSITIVE
        .get_or_init(|| {
            Regex::new(r"(?im)^((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*)[^\r\n]*")
                .expect("valid sensitive header regex")
        })
        .replace_all(&text, "$1[REDACTED]")
        .into_owned();
    text = KEY_VALUE_SENSITIVE
        .get_or_init(|| {
            Regex::new(
                r#"(?i)((?:api[_-]?key|access[_-]?token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)"#,
            )
            .expect("valid sensitive key/value regex")
        })
        .replace_all(&text, "$1[REDACTED]")
        .into_owned();
    text = BEARER
        .get_or_init(|| {
            Regex::new(r#"(?i)(\bbearer\s+)[^\s,;"'<>]+"#).expect("valid bearer token regex")
        })
        .replace_all(&text, |captures: &Captures<'_>| {
            format!("{}[REDACTED]", &captures[1])
        })
        .into_owned();

    let mut output = String::with_capacity(text.len().min(MAX_ERROR_MESSAGE_CHARS));
    for character in text.chars() {
        if output.len() + character.len_utf8() > MAX_ERROR_MESSAGE_CHARS {
            output.push_str(" …");
            break;
        }
        output.push(character);
    }
    output
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    pub const TEST_TIMEOUT: Duration = Duration::from_secs(3);

    pub struct StreamingServer {
        pub base_url: String,
        task: Option<tokio::task::JoinHandle<Vec<u8>>>,
    }

    impl StreamingServer {
        pub async fn finish(mut self) -> Vec<u8> {
            let mut task = self.task.take().expect("mock server task must be present");
            match tokio::time::timeout(TEST_TIMEOUT, &mut task).await {
                Ok(result) => result.expect("mock server task must not panic"),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    panic!("mock server did not shut down within {TEST_TIMEOUT:?}");
                }
            }
        }
    }

    impl Drop for StreamingServer {
        fn drop(&mut self) {
            if let Some(task) = self.task.take() {
                task.abort();
            }
        }
    }

    pub async fn streaming_server(
        content_type: &'static str,
        chunks: Vec<(Duration, Vec<u8>)>,
        _complete: bool,
    ) -> StreamingServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let count = socket.read(&mut buffer).await.unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..count]);
                if let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(str::trim)
                                .and_then(|value| value.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= header_end + 4 + content_length {
                        break;
                    }
                }
            }
            let body_len: usize = chunks.iter().map(|(_, chunk)| chunk.len()).sum();
            if socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {body_len}\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .is_err()
            {
                return request;
            }
            for (delay, chunk) in chunks {
                tokio::time::sleep(delay).await;
                if socket.write_all(&chunk).await.is_err() {
                    return request;
                }
            }
            let _ = socket.shutdown().await;
            request
        });
        StreamingServer {
            base_url: format!("http://{address}"),
            task: Some(task),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_in_headers_fields_and_urls() {
        let cases = [
            ("Bearer abc.def-_~+/=", "abc.def-_"),
            ("Authorization: bEaReR arbitrary-token", "arbitrary-token"),
            ("Cookie: session=secret; theme=dark", "session=secret"),
            ("Set-Cookie: auth=secret; HttpOnly", "auth=secret"),
            (
                r#"api_key="api secret" access-token=access-secret"#,
                "api secret",
            ),
            (
                "https://example.test/x?safe=yes&access_token=url-secret#part",
                "url-secret",
            ),
            (
                "https://example.test/x?API-KEY=query-secret&safe=yes",
                "query-secret",
            ),
        ];

        for (input, secret) in cases {
            let sanitized = sanitize_error_body(input.as_bytes());
            assert!(!sanitized.contains(secret), "secret leaked for {input:?}");
            assert!(sanitized.contains("[REDACTED]"), "not redacted: {input:?}");
        }
    }

    #[test]
    fn preserves_non_sensitive_error_context_and_limits_text() {
        let input = format!("invalid request: field=model {}", "界".repeat(1000));
        let sanitized = sanitize_error_body(input.as_bytes());

        assert!(sanitized.starts_with("invalid request: field=model"));
        assert!(sanitized.len() <= MAX_ERROR_MESSAGE_CHARS + " …".len());
        assert!(sanitized.is_char_boundary(sanitized.len()));
    }
}
