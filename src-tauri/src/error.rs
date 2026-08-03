use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ErrorDto {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_id: Option<String>,
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Credential error: {0}")]
    Credential(String),

    #[error("AI error: {0}")]
    Ai(String),

    #[error("AI authentication failed: {0}")]
    AiAuthentication(String),

    #[error("AI request was rate limited: {0}")]
    AiRateLimited(String),

    #[error("AI upstream error: {0}")]
    AiUpstream(String),

    #[error("AI input exceeds the model context limit: {0}")]
    AiContext(String),

    #[error("AI response could not be parsed: {0}")]
    AiResponse(String),

    #[error("Not a git repository: {0}")]
    NotARepo(String),

    #[error("{0}")]
    General(String),
}

impl AppError {
    pub fn dto(&self) -> ErrorDto {
        let (code, retryable) = match self {
            Self::Git(_) => ("git_error", false),
            Self::Io(_) => ("io_error", false),
            Self::Http(error) if error.is_timeout() => ("ai_timeout", true),
            Self::Http(error) if error.is_connect() => ("ai_network", true),
            Self::Http(_) => ("http_error", true),
            Self::Json(_) | Self::AiResponse(_) => ("ai_response_invalid", false),
            Self::Config(_) => ("config_error", false),
            Self::Credential(_) => ("credential_error", false),
            Self::Ai(_) => ("ai_error", false),
            Self::AiAuthentication(_) => ("ai_authentication", false),
            Self::AiRateLimited(_) => ("ai_rate_limited", true),
            Self::AiContext(_) => ("ai_context_exceeded", false),
            Self::AiUpstream(_) => ("ai_upstream", true),
            Self::NotARepo(_) => ("not_a_repository", false),
            Self::General(_) => ("general_error", false),
        };

        ErrorDto {
            code: code.to_string(),
            message: self.to_string(),
            retryable,
            diagnostic_id: Some(Uuid::new_v4().to_string()),
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.dto().serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_a_stable_frontend_compatible_dto() {
        let value = serde_json::to_value(AppError::AiAuthentication("check API key".into()))
            .expect("serialize error");

        assert_eq!(value["code"], "ai_authentication");
        assert_eq!(value["message"], "AI authentication failed: check API key");
        assert_eq!(value["retryable"], false);
        assert!(value["diagnostic_id"].as_str().is_some());
    }

    #[test]
    fn maps_context_exceeded_to_a_non_retryable_code() {
        let value = serde_json::to_value(AppError::AiContext("input too long".into()))
            .expect("serialize error");

        assert_eq!(value["code"], "ai_context_exceeded");
        assert_eq!(value["retryable"], false);
    }
}
