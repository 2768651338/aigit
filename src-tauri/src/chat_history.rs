use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

const STORE_VERSION: u32 = 1;
const MAX_STORE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SESSIONS: usize = 500;
const MAX_MESSAGES_PER_SESSION: usize = 2_000;
const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;

/// Serializes chat-history read-modify-write sequences. The store is a single
/// JSON file rewritten in full on every save, so concurrent commands (e.g.
/// two sessions saving at once) would otherwise load the same snapshot and
/// the last writer would silently drop the other's session.
static CHAT_STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock_chat_store() -> AppResult<std::sync::MutexGuard<'static, ()>> {
    CHAT_STORE_LOCK
        .lock()
        .map_err(|_| AppError::Config("Chat history lock is unavailable".into()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAttachment {
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(default)]
    pub estimated_tokens: u64,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    #[serde(default)]
    pub attachments: Vec<StoredAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub repo_path: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatStore {
    version: u32,
    #[serde(default)]
    sessions: Vec<ChatSession>,
}

impl Default for ChatStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            sessions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatLoadResult {
    pub sessions: Vec<ChatSession>,
    pub recovered_corrupt_data: bool,
}

fn store_path() -> AppResult<PathBuf> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| AppError::Config("Cannot determine local data directory".into()))?
        .join("aigit");
    fs::create_dir_all(&root)?;
    Ok(root.join("chat-history.json"))
}

fn validate_session(session: &ChatSession) -> AppResult<()> {
    if session.id.trim().is_empty() || session.repo_path.trim().is_empty() {
        return Err(AppError::Config(
            "Chat session has an invalid identity".into(),
        ));
    }
    if session.title.chars().count() > 200 || session.messages.len() > MAX_MESSAGES_PER_SESSION {
        return Err(AppError::Config(
            "Chat session exceeds storage limits".into(),
        ));
    }
    for message in &session.messages {
        if !matches!(message.role.as_str(), "user" | "assistant" | "system")
            || message.content.len() > MAX_MESSAGE_BYTES
        {
            return Err(AppError::Config(
                "Chat message is invalid or too large".into(),
            ));
        }
    }
    Ok(())
}

fn quarantine_corrupt(path: &Path) {
    let stamp = chrono::Utc::now().timestamp_millis();
    let backup = path.with_file_name(format!("chat-history.corrupt-{stamp}.json"));
    let _ = fs::rename(path, backup);
}

fn load_store(path: &Path) -> AppResult<(ChatStore, bool)> {
    if !path.exists() {
        return Ok((ChatStore::default(), false));
    }
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_STORE_BYTES {
        quarantine_corrupt(path);
        return Ok((ChatStore::default(), true));
    }
    let bytes = fs::read(path)?;
    // Sealed with DPAPI on Windows; legacy plaintext passes through and is
    // re-sealed on the next save.
    let bytes = crate::crypto::decrypt_at_rest(&bytes)?;
    let store: ChatStore = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            quarantine_corrupt(path);
            return Ok((ChatStore::default(), true));
        }
    };
    if store.version != STORE_VERSION
        || store.sessions.len() > MAX_SESSIONS
        || store
            .sessions
            .iter()
            .any(|session| validate_session(session).is_err())
    {
        quarantine_corrupt(path);
        return Ok((ChatStore::default(), true));
    }
    Ok((store, false))
}

fn save_store(path: &Path, store: &ChatStore) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(store)?;
    if bytes.len() as u64 > MAX_STORE_BYTES {
        return Err(AppError::Config(
            "Chat history exceeds the 32 MiB storage limit".into(),
        ));
    }
    let sealed = crate::crypto::encrypt_at_rest(&bytes);
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| {
            file.write_all(&sealed)?;
            file.flush()?;
            file.sync_all()
        })
        .map_err(|error| {
            AppError::Config(format!("Failed to atomically save chat history: {error}"))
        })
}

#[tauri::command]
pub fn load_chat_sessions(repo_path: String) -> AppResult<ChatLoadResult> {
    let _guard = lock_chat_store()?;
    load_sessions_at(&store_path()?, &repo_path)
}

fn load_sessions_at(path: &Path, repo_path: &str) -> AppResult<ChatLoadResult> {
    let (store, recovered_corrupt_data) = load_store(path)?;
    let mut sessions: Vec<_> = store
        .sessions
        .into_iter()
        .filter(|session| session.repo_path == repo_path)
        .collect();
    sessions.sort_by_key(|session| std::cmp::Reverse(session.updated_at));
    Ok(ChatLoadResult {
        sessions,
        recovered_corrupt_data,
    })
}

#[tauri::command]
pub fn save_chat_session(session: ChatSession) -> AppResult<()> {
    validate_session(&session)?;
    upsert_session_at(&store_path()?, session)
}

fn upsert_session_at(path: &Path, session: ChatSession) -> AppResult<()> {
    let _guard = lock_chat_store()?;
    let (mut store, _) = load_store(path)?;
    if let Some(existing) = store.sessions.iter_mut().find(|item| item.id == session.id) {
        if existing.repo_path != session.repo_path {
            return Err(AppError::Config(
                "Cannot move a chat session between repositories".into(),
            ));
        }
        *existing = session;
    } else {
        if store.sessions.len() >= MAX_SESSIONS {
            return Err(AppError::Config("Too many saved chat sessions".into()));
        }
        store.sessions.push(session);
    }
    save_store(path, &store)
}

#[tauri::command]
pub fn delete_chat_session(repo_path: String, session_id: String) -> AppResult<()> {
    delete_session_at(&store_path()?, &repo_path, &session_id)
}

fn delete_session_at(path: &Path, repo_path: &str, session_id: &str) -> AppResult<()> {
    let _guard = lock_chat_store()?;
    let (mut store, _) = load_store(path)?;
    store
        .sessions
        .retain(|session| !(session.repo_path == repo_path && session.id == session_id));
    save_store(path, &store)
}

#[tauri::command]
pub fn clear_chat_history(repo_path: Option<String>) -> AppResult<()> {
    clear_sessions_at(&store_path()?, repo_path.as_deref())
}

fn clear_sessions_at(path: &Path, repo_path: Option<&str>) -> AppResult<()> {
    let _guard = lock_chat_store()?;
    let (mut store, _) = load_store(path)?;
    match repo_path {
        Some(repo) => store.sessions.retain(|session| session.repo_path != repo),
        None => store.sessions.clear(),
    }
    save_store(path, &store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_data_is_quarantined_instead_of_deserialized() {
        let root = std::env::temp_dir().join(format!("aigit-chat-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("chat-history.json");
        fs::write(&path, b"{not-json").unwrap();
        let (store, recovered) = load_store(&path).unwrap();
        assert!(recovered);
        assert!(store.sessions.is_empty());
        assert!(!path.exists());
        assert!(fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("chat-history.corrupt-")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_oversized_messages() {
        let session = ChatSession {
            id: "id".into(),
            repo_path: "repo".into(),
            title: "title".into(),
            created_at: 0,
            updated_at: 0,
            messages: vec![StoredMessage {
                id: "m".into(),
                role: "user".into(),
                content: "x".repeat(MAX_MESSAGE_BYTES + 1),
                created_at: 0,
                attachments: vec![],
            }],
        };
        assert!(validate_session(&session).is_err());
    }

    #[test]
    fn concurrent_saves_do_not_lose_sessions() {
        let root =
            std::env::temp_dir().join(format!("aigit-chat-concurrent-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = std::sync::Arc::new(root.join("chat-history.json"));

        let mut handles = Vec::new();
        for worker in 0..8u32 {
            let path = path.clone();
            handles.push(std::thread::spawn(move || {
                for index in 0..5usize {
                    let session = ChatSession {
                        id: format!("w{worker}-s{index}"),
                        repo_path: "repo".into(),
                        title: format!("session {worker}-{index}"),
                        created_at: 0,
                        updated_at: (worker * 5 + index as u32) as i64,
                        messages: Vec::new(),
                    };
                    upsert_session_at(&path, session).expect("concurrent save must succeed");
                }
            }));
        }
        for handle in handles {
            handle.join().expect("worker thread");
        }

        let (store, recovered) = load_store(&path).unwrap();
        assert!(!recovered);
        assert_eq!(store.sessions.len(), 40);
        let _ = fs::remove_dir_all(root);
    }
}
