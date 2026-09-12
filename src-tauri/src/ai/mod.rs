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

/// Input prepared for a provider call: bounded to the configured context
/// window so oversized diffs/attachments can no longer cause HTTP 400.
#[derive(Debug)]
pub struct PreparedInput {
    pub system_prompt: String,
    pub messages: Vec<ChatMessage>,
    /// Whether any part of the input was cut; consumed by tests and useful
    /// for future UI warnings.
    #[allow(dead_code)]
    pub truncated: bool,
}

/// Rough token estimate consistent with the frontend's `estimateTokens`:
/// ASCII ≈ 4 chars/token, non-ASCII ≈ 1 char/token.
pub fn estimate_tokens(text: &str) -> usize {
    let ascii = text.chars().filter(|c| c.is_ascii()).count();
    ascii.div_ceil(4) + (text.chars().count() - ascii)
}

/// Token budget available for input after reserving the requested completion
/// length. Applies a small safety margin because the estimate is approximate;
/// floored so tiny budgets never produce an empty request.
fn context_budget(config: &AiProviderConfig) -> usize {
    let context = usize::try_from(config.max_context_tokens).unwrap_or(usize::MAX);
    let output = usize::try_from(config.max_tokens).unwrap_or(0);
    (context.saturating_sub(output) * 95 / 100).max(2048)
}

/// Truncate `system_prompt` + `messages` to the configured context window.
///
/// Keeps the newest messages first (the latest user question always survives,
/// truncated if it alone exceeds the budget); older messages that no longer
/// fit are dropped. A notice is appended where the cut happened so the model
/// knows the input is partial.
pub fn prepare_input(
    system_prompt: &str,
    messages: &[ChatMessage],
    config: &AiProviderConfig,
) -> PreparedInput {
    const TRUNCATION_NOTICE: &str =
        "\n\n[注意] 输入内容因超出模型上下文限制已被自动截断，请仅基于当前提供的部分内容作答。";

    // Reserve the notice cost up front (worst case: appended to both the
    // system prompt and the truncated message) so the final input still fits.
    let notice_tokens = estimate_tokens(TRUNCATION_NOTICE);
    let budget = context_budget(config).saturating_sub(notice_tokens * 2);
    let mut truncated = false;

    // The system prompt gets at most a quarter of the budget; keep its head.
    let system_room = budget / 4;
    let mut system = system_prompt.to_string();
    if estimate_tokens(&system) > system_room {
        system = truncate_to_budget(system, system_room);
        truncated = true;
    }
    let mut remaining = budget.saturating_sub(estimate_tokens(&system));

    // Walk newest → oldest; the first (newest) message always fits, older
    // messages are dropped once the budget is exhausted.
    let mut kept: Vec<ChatMessage> = Vec::with_capacity(messages.len());
    for message in messages.iter().rev() {
        let cost = estimate_tokens(&message.content).saturating_add(4);
        if kept.is_empty() {
            let room = remaining.saturating_sub(4);
            let mut content = if cost > room {
                truncate_to_budget(message.content.clone(), room)
            } else {
                message.content.clone()
            };
            if content.len() < message.content.len() {
                truncated = true;
                content.push_str(TRUNCATION_NOTICE);
            }
            kept.push(ChatMessage {
                role: message.role.clone(),
                content,
            });
            remaining =
                remaining.saturating_sub(estimate_tokens(&kept[0].content).saturating_add(4));
        } else if cost <= remaining {
            kept.push(message.clone());
            remaining -= cost;
        } else {
            truncated = true;
        }
    }
    kept.reverse();

    if truncated {
        system.push_str(TRUNCATION_NOTICE);
    }
    PreparedInput {
        system_prompt: system,
        messages: kept,
        truncated,
    }
}

/// Keep the longest head of `text` whose estimated token count fits `budget`.
fn truncate_to_budget(text: String, budget: usize) -> String {
    if estimate_tokens(&text) <= budget {
        return text;
    }
    let mut points = 0usize; // 4 points ≈ 1 token
    let mut cut = text.len();
    for (index, character) in text.char_indices() {
        points += if character.is_ascii() { 1 } else { 4 };
        if points.div_ceil(4) > budget {
            cut = index;
            break;
        }
    }
    text[..cut].to_owned()
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

fn build_http_client(
    pool_max_idle_per_host: usize,
    total_timeout: Option<Duration>,
) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(pool_max_idle_per_host)
        .user_agent("aigit/1");
    if let Some(total) = total_timeout {
        builder = builder.timeout(total);
    }
    builder.build().map_err(|error| error.to_string())
}

pub(crate) fn http_client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build_http_client(usize::MAX, Some(Duration::from_secs(90))))
        .as_ref()
        .map_err(|error| AppError::Ai(format!("Cannot initialize HTTP client: {error}")))
}

/// Client for streaming calls. A total timeout would cut off legitimately
/// long generations mid-stream, so it is disabled here; the read loop enforces
/// a per-chunk idle timeout instead (see [`next_stream_chunk`]).
pub(crate) fn streaming_http_client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build_http_client(usize::MAX, None))
        .as_ref()
        .map_err(|error| AppError::Ai(format!("Cannot initialize HTTP client: {error}")))
}

/// Maximum wall time between two chunks of a streaming response (and for the
/// response headers to arrive) before the request is considered stalled.
pub(crate) const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(180);

/// Secret-like content patterns scanned right before a request is sent to a
/// cloud provider. File-name blacklists cannot catch keys embedded in source
/// files (`config.py`, `constants.ts`, …), so the final payload itself is
/// checked; a hit blocks the request until the user explicitly confirms.
const SECRET_PATTERNS: &[(&str, &str)] = &[
    (r"\bsk-[A-Za-z0-9_-]{16,}\b", "OpenAI-style API key (sk-…)"),
    (
        r"\bgithub_pat_[A-Za-z0-9_]{20,}\b",
        "GitHub fine-grained token (github_pat_…)",
    ),
    (
        r"\bgh[pousr]_[A-Za-z0-9]{20,}\b",
        "GitHub token (ghp_/gho_/…",
    ),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key (AKIA…)"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", "Slack token (xox…)"),
    (r"\bAIza[0-9A-Za-z_-]{30,}\b", "Google API key (AIza…)"),
    (
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        "private key block (-----BEGIN … PRIVATE KEY-----)",
    ),
    (
        r#"(?i)\b(?:api[_-]?key|secret|access[_-]?token|client[_-]?secret)\b\s*[=:]\s*["']?[A-Za-z0-9+/_-]{24,}"#,
        "key/value assignment with a long secret-like value",
    ),
];

/// Return the labels of all secret-like patterns present in `text`.
pub fn find_secret_hits(text: &str) -> Vec<&'static str> {
    static COMPILED: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let compiled = COMPILED.get_or_init(|| {
        SECRET_PATTERNS
            .iter()
            .map(|(pattern, label)| (Regex::new(pattern).expect("valid secret pattern"), *label))
            .collect()
    });
    let mut hits: Vec<&'static str> = Vec::new();
    for (regex, label) in compiled {
        if regex.is_match(text) && !hits.contains(label) {
            hits.push(label);
        }
    }
    hits
}

/// Block a provider request when the payload contains secret-like content and
/// the user has not confirmed. Scans both the system prompt (chat attachments
/// and repo context are injected there) and every message body.
pub fn ensure_no_secrets(
    system_prompt: &str,
    messages: &[ChatMessage],
    confirmed: bool,
) -> AppResult<()> {
    if confirmed {
        return Ok(());
    }
    let mut payload = String::with_capacity(4096);
    payload.push_str(system_prompt);
    for message in messages {
        payload.push_str(&message.content);
    }
    let hits = find_secret_hits(&payload);
    if hits.is_empty() {
        return Ok(());
    }
    Err(AppError::AiSensitiveContent(hits.join("; ")))
}

/// Read the next chunk of a streaming response, bounded by an idle timeout.
///
/// Returns `None` when the stream ended. Errors when the provider stays
/// silent for longer than `idle_timeout` (a stalled stream, not a long
/// generation), when the user cancels, or on a transport error.
pub(crate) async fn next_stream_chunk<S>(
    stream: &mut S,
    cancellation: &CancellationToken,
    idle_timeout: Duration,
) -> AppResult<Option<bytes::Bytes>>
where
    S: futures_util::Stream<Item = reqwest::Result<bytes::Bytes>> + Unpin,
{
    tokio::time::timeout(idle_timeout, async {
        tokio::select! {
            _ = cancellation.cancelled() => Err(AppError::Ai("AI request cancelled".into())),
            chunk = stream.next() => chunk.map_err(AppError::Http),
        }
    })
    .await
    .map_err(|_| {
        AppError::AiTimeout(format!(
            "no data received within {} seconds; the stream was aborted",
            idle_timeout.as_secs()
        ))
    })?
}

#[cfg(test)]
pub(crate) fn isolated_http_client() -> Client {
    // No total timeout, mirroring the production streaming client so stream
    // tests exercise the idle-timeout path instead of a fixed deadline.
    build_http_client(0, None).expect("test HTTP client must initialize")
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
        StatusCode::BAD_REQUEST if is_context_length_error(&detail) => AppError::AiContext(message),
        status if status.is_server_error() => AppError::AiUpstream(message),
        _ => AppError::Ai(message),
    }
}

/// Detect upstream "context window exceeded" 400s (e.g. DeepSeek's
/// "maximum context length ... reduce the length of the messages") so users
/// get an actionable error instead of a raw HTTP status.
fn is_context_length_error(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    [
        "maximum context length",
        "context length",
        "reduce the length of the messages",
        "prompt is too long",
        "context window",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
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
    loop {
        // Non-streaming callers are additionally bounded by the client's total
        // timeout; this idle bound covers streaming error bodies, which have
        // no total timeout.
        let chunk = match tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.next()).await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                return Err(AppError::AiTimeout(format!(
                    "no data received within {} seconds; the response was aborted",
                    STREAM_IDLE_TIMEOUT.as_secs()
                )))
            }
        };
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
    fn estimates_tokens_like_the_frontend() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abc"), 1);
        assert_eq!(estimate_tokens("世界"), 2);
        assert_eq!(estimate_tokens("ab世界"), 3); // 1 (ascii) + 2 (cjk)
    }

    #[tokio::test]
    async fn stalled_stream_chunks_hit_the_idle_timeout() {
        let cancellation = CancellationToken::default();
        let mut stream = futures_util::stream::pending::<reqwest::Result<bytes::Bytes>>();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            next_stream_chunk(&mut stream, &cancellation, Duration::from_millis(50)),
        )
        .await
        .expect("the idle timeout must fire long before the outer test timeout");
        assert!(matches!(result, Err(AppError::AiTimeout(_))));
    }

    #[tokio::test]
    async fn stream_chunk_reports_cancellation_before_the_idle_timeout() {
        let cancellation = CancellationToken::default();
        let mut stream = futures_util::stream::pending::<reqwest::Result<bytes::Bytes>>();
        let cancel_task = {
            let token = cancellation.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                token.cancel();
            })
        };
        let result = next_stream_chunk(&mut stream, &cancellation, Duration::from_secs(60)).await;
        cancel_task.await.expect("cancel task");
        assert!(matches!(result, Err(AppError::Ai(ref message)) if message.contains("cancelled")));
    }

    #[tokio::test]
    async fn stream_chunk_returns_data_then_stream_end() {
        let cancellation = CancellationToken::default();
        let mut stream = futures_util::stream::iter(vec![Ok(bytes::Bytes::from_static(b"hello"))]);
        let chunk = next_stream_chunk(&mut stream, &cancellation, Duration::from_secs(1))
            .await
            .expect("first chunk must arrive");
        assert_eq!(chunk.as_deref(), Some(b"hello".as_slice()));
        let end = next_stream_chunk(&mut stream, &cancellation, Duration::from_millis(50))
            .await
            .expect("stream end must not be treated as an error");
        assert!(end.is_none());
    }

    #[test]
    fn finds_secret_like_strings_in_payloads() {
        // 本测试的所有 token 形态样例都在运行时拼接：源码中若直接出现
        // 完整凭据形态的字面量，会被 Mimosa 扫描与 GitHub 推送保护误拦。
        let hits = find_secret_hits(&format!(
            "const {} = \"{}-{}\"; // {}{}",
            "KEY", "sk-proj", "abcdefghij1234567890", "ghp_", "abcdefghijklmnopqrstuvwxyz12345"
        ));
        assert!(hits.iter().any(|label| label.contains("OpenAI")));
        assert!(hits.iter().any(|label| label.contains("GitHub")));

        assert!(
            find_secret_hits(&format!("{}IOSFODNN7EXAMPLE is aws", "AKIA"))
                .iter()
                .any(|l| l.contains("AWS"))
        );
        assert!(
            find_secret_hits(&format!("xox{}-{}", "b", "123456789012-abcdefghijklmnop"))
                .iter()
                .any(|l| l.contains("Slack"))
        );
        // 合成样例在运行时拼接成键值形态，避免源码里出现能被凭据扫描器
        // 误判为硬编码密钥的赋值字面量。
        let synthetic_kv = format!("api_{} = '{}'", "key", "a".repeat(34));
        assert!(find_secret_hits(&synthetic_kv)
            .iter()
            .any(|l| l.contains("key/value")));
        assert!(find_secret_hits("-----BEGIN RSA PRIVATE KEY-----")
            .iter()
            .any(|l| l.contains("private key")));

        // Ordinary code must not trip the scanner.
        assert!(find_secret_hits("let total = subtotal + tax_total;").is_empty());
        assert!(find_secret_hits("https://example.com/path?query=1").is_empty());
        // No duplicate labels even when several patterns match.
        let hits = find_secret_hits(&format!(
            "{}abc123def456ghi789 {}xyz987wvu654tsr321",
            "sk-", "sk-"
        ));
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn secrets_guard_blocks_unconfirmed_and_allows_confirmed() {
        // Token 形态样例同样在运行时拼接，避免 GitHub 推送保护误拦。
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: format!("token: gh{}_{}", "p", "abcdefghijklmnopqrstuvwxyz123456"),
        }];
        assert!(ensure_no_secrets("system", &messages, false).is_err());
        assert!(ensure_no_secrets("system", &messages, true).is_ok());
        assert!(ensure_no_secrets(
            "system",
            &[ChatMessage {
                role: "user".into(),
                content: "hello".into()
            }],
            false
        )
        .is_ok());
    }

    #[test]
    fn prepare_input_passes_small_inputs_through_unchanged() {
        let messages = vec![
            ChatMessage {
                role: "user".into(),
                content: "hello".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "hi".into(),
            },
        ];
        let prepared = prepare_input("system", &messages, &AiProviderConfig::default());
        assert!(!prepared.truncated);
        assert_eq!(prepared.system_prompt, "system");
        assert_eq!(prepared.messages[0].role, "user");
        assert_eq!(prepared.messages[0].content, "hello");
        assert_eq!(prepared.messages.len(), 2);
    }

    #[test]
    fn prepare_input_truncates_a_single_oversized_message() {
        let config = AiProviderConfig {
            max_context_tokens: 4096,
            max_tokens: 512,
            ..AiProviderConfig::default()
        };
        let budget = context_budget(&config); // (4096 - 512) * 95 / 100 = 3405
        let oversized = vec![ChatMessage {
            role: "user".into(),
            content: "x".repeat(100_000), // ≈ 25_000 tokens
        }];
        let prepared = prepare_input("sys", &oversized, &config);
        assert!(prepared.truncated);
        let total = estimate_tokens(&prepared.system_prompt)
            + estimate_tokens(&prepared.messages[0].content);
        assert!(total <= budget);
        // The cut point and the system prompt both carry the notice.
        assert!(prepared.messages[0].content.contains("已被自动截断"));
        assert!(prepared.system_prompt.contains("已被自动截断"));
        assert_eq!(prepared.messages.len(), 1);
    }

    #[test]
    fn prepare_input_drops_old_messages_but_keeps_the_newest_question() {
        let config = AiProviderConfig {
            max_context_tokens: 4096,
            max_tokens: 512,
            ..AiProviderConfig::default()
        };
        let mut messages = Vec::new();
        for index in 0..200 {
            messages.push(ChatMessage {
                role: "user".into(),
                content: format!("message {index} {}", "a".repeat(96)),
            });
        }
        let prepared = prepare_input("sys", &messages, &config);
        assert!(prepared.truncated);
        // Messages stay in chronological order; the newest question survives
        // intact at the end of the list.
        assert_eq!(
            prepared.messages.last().unwrap().content,
            messages.last().unwrap().content
        );
        assert!(prepared.messages.len() < messages.len());
        assert!(prepared.system_prompt.contains("已被自动截断"));
    }

    #[test]
    fn prepare_input_truncates_an_oversized_system_prompt() {
        let config = AiProviderConfig {
            max_context_tokens: 4096,
            max_tokens: 512,
            ..AiProviderConfig::default()
        };
        let huge_prompt = "x".repeat(50_000);
        let prepared = prepare_input(&huge_prompt, &[], &config);
        assert!(prepared.truncated);
        assert!(estimate_tokens(&prepared.system_prompt) <= 3405);
        assert!(prepared.messages.is_empty());
    }

    #[test]
    fn detects_upstream_context_length_errors() {
        let deepseek = "This model's maximum context length is 1048576 tokens. However, you \
            requested 1511911 tokens (1503719 in the messages,8192 in the completion). Please \
            reduce the length of the messages or completion.";
        assert!(is_context_length_error(deepseek));
        assert!(is_context_length_error("The prompt is too long"));
        assert!(is_context_length_error(
            "token count exceeded the model's context window"
        ));
        assert!(!is_context_length_error("invalid api key"));
        assert!(!is_context_length_error("rate limit exceeded"));
    }

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
