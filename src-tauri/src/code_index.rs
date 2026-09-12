use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::ai::{http_client, read_json_limited, upstream_error};
use crate::config::settings::IndexConfig;
use crate::config::{AppConfig, CredentialStore, SystemCredentialStore};
use crate::error::{AppError, AppResult};
use crate::git;

const FORMAT_VERSION: u32 = 2;
const TOKENIZER_VERSION: &str = "unicode-alnum-v1";
const MAX_INDEX_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILE_BYTES_HARD: usize = 2 * 1024 * 1024;
const MAX_CHUNKS_HARD: usize = 50_000;
const EMBEDDING_BATCH: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodeChunk {
    pub id: String,
    pub path: String,
    /// SHA-256 of the bytes read from the current worktree (also used for untracked files).
    pub blob_oid: String,
    pub start_line: u32,
    pub end_line: u32,
    pub language: String,
    pub symbols: Vec<String>,
    pub text: String,
    #[serde(default)]
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct IndexMetadata {
    head: String,
    index_snapshot: String,
    worktree_snapshot: String,
    exclusion_key: String,
    embedding_key: String,
    tokenizer_version: String,
    include_untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RepoIndex {
    version: u32,
    repo_path: String,
    metadata: IndexMetadata,
    updated_at: i64,
    chunks: Vec<CodeChunk>,
    /// Persistent lexical inverted index: normalized term -> sorted chunk ordinals.
    postings: BTreeMap<String, Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IndexPhase {
    Idle,
    Scanning,
    Embedding,
    Ready,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub phase: IndexPhase,
    pub files_total: usize,
    pub files_processed: usize,
    pub chunks: usize,
    pub reused_chunks: usize,
    pub stale: bool,
    pub message: Option<String>,
    pub updated_at: i64,
}

impl Default for IndexStatus {
    fn default() -> Self {
        Self {
            phase: IndexPhase::Idle,
            files_total: 0,
            files_processed: 0,
            chunks: 0,
            reused_chunks: 0,
            stale: false,
            message: None,
            updated_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub language: String,
    pub symbols: Vec<String>,
    pub score: f32,
    pub text: String,
}

#[derive(Default)]
pub struct IndexManager {
    jobs: Mutex<HashMap<String, JobState>>,
}

#[derive(Clone)]
struct JobState {
    generation: u64,
    status: IndexStatus,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone)]
struct SourceFile {
    path: String,
    content_hash: String,
    bytes: Vec<u8>,
}

struct RepoSnapshot {
    metadata: IndexMetadata,
    files: Vec<SourceFile>,
    /// Per-file (mtime_ns, size) fingerprints recorded during the scan; used
    /// by the staleness fast path to skip full re-hashing on status queries.
    file_stats: BTreeMap<String, (i64, u64)>,
}

/// Stat-only fingerprint cache of the last full worktree scan, keyed by repo.
/// Lets repeated `status`/`search` staleness checks compare file mtimes and
/// sizes instead of re-reading and re-hashing every candidate file.
static WORKTREE_CACHE: OnceLock<Mutex<HashMap<String, WorktreeFingerprint>>> = OnceLock::new();

fn worktree_cache() -> &'static Mutex<HashMap<String, WorktreeFingerprint>> {
    WORKTREE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
struct WorktreeFingerprint {
    /// worktree_snapshot digest produced by the scan that recorded `files`.
    snapshot: String,
    files: BTreeMap<String, (i64, u64)>,
}

fn stat_fingerprint(metadata: &fs::Metadata) -> (i64, u64) {
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos() as i64)
        .unwrap_or(0);
    (mtime, metadata.len())
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn digest_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn digest_fields<'a>(fields: impl IntoIterator<Item = &'a str>) -> String {
    let mut digest = Sha256::new();
    for field in fields {
        digest.update((field.len() as u64).to_le_bytes());
        digest.update(field.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn repo_key(repo_path: &str) -> String {
    digest_bytes(repo_path.as_bytes())
}

fn index_path(repo_path: &str) -> AppResult<PathBuf> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| AppError::Config("Cannot determine local data directory".into()))?
        .join("aigit")
        .join("code-index");
    fs::create_dir_all(&root)?;
    Ok(root.join(format!("{}.json", repo_key(repo_path))))
}

fn embeddings_path(repo_path: &str) -> AppResult<PathBuf> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| AppError::Config("Cannot determine local data directory".into()))?
        .join("aigit")
        .join("code-index");
    fs::create_dir_all(&root)?;
    Ok(root.join(format!("{}.embeddings.bin", repo_key(repo_path))))
}

/// Binary sidecar layout (little-endian): 8-byte magic, u32 record count,
/// then per record: u32 id length, id bytes (UTF-8), u32 dimension, f32 array.
/// Storing vectors as raw f32 instead of JSON text cuts the on-disk index
/// roughly by an order of magnitude and removes the JSON parse cost.
const EMBEDDINGS_MAGIC: &[u8; 8] = b"AIGITEB1";

fn write_embeddings(path: &Path, chunks: &[CodeChunk]) -> AppResult<()> {
    let mut bytes = Vec::new();
    let count = chunks
        .iter()
        .filter(|chunk| !chunk.embedding.is_empty())
        .count();
    if count == 0 {
        // No embeddings (local-only mode) — a stale sidecar must not survive.
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }
    bytes.extend_from_slice(EMBEDDINGS_MAGIC);
    bytes.extend_from_slice(&(count as u32).to_le_bytes());
    for chunk in chunks {
        if chunk.embedding.is_empty() {
            continue;
        }
        let id = chunk.id.as_bytes();
        bytes.extend_from_slice(&(id.len() as u32).to_le_bytes());
        bytes.extend_from_slice(id);
        bytes.extend_from_slice(&(chunk.embedding.len() as u32).to_le_bytes());
        for value in &chunk.embedding {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    if bytes.len() as u64 > MAX_INDEX_BYTES {
        return Err(AppError::Config(
            "Code index exceeds the 128 MiB storage limit".into(),
        ));
    }
    let sealed = crate::crypto::encrypt_at_rest(&bytes);
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| {
            file.write_all(&sealed)?;
            file.flush()?;
            file.sync_all()
        })
        .map_err(|e| AppError::Config(format!("Failed to save code index embeddings: {e}")))
}

/// Parse the embeddings sidecar. A malformed file is quarantined and reported
/// as empty — the index then behaves like "never embedded" and can be rebuilt.
fn read_embeddings(path: &Path) -> HashMap<String, Vec<f32>> {
    let mut result = HashMap::new();
    let raw = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return result,
    };
    let bytes = match crate::crypto::decrypt_at_rest(&raw) {
        Ok(bytes) => bytes,
        Err(_) => return result,
    };
    let mut fail = |path: &Path| {
        let stamp = chrono::Utc::now().timestamp_millis();
        let _ = fs::rename(
            path,
            path.with_file_name(format!("embeddings.corrupt-{stamp}.bin")),
        );
        result.clear();
    };
    if bytes.len() < 12 || &bytes[..8] != EMBEDDINGS_MAGIC {
        fail(path);
        return result;
    }
    let count = u32::from_le_bytes(bytes[8..12].try_into().unwrap_or([0; 4])) as usize;
    let mut cursor = 12usize;
    for _ in 0..count {
        if cursor + 4 > bytes.len() {
            fail(path);
            return result;
        }
        let id_len =
            u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap_or([0; 4])) as usize;
        cursor += 4;
        if cursor + id_len + 4 > bytes.len() {
            fail(path);
            return result;
        }
        let Ok(id) = std::str::from_utf8(&bytes[cursor..cursor + id_len]) else {
            fail(path);
            return result;
        };
        cursor += id_len;
        let dim =
            u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap_or([0; 4])) as usize;
        cursor += 4;
        if dim == 0 || dim > 16_384 || cursor + dim * 4 > bytes.len() {
            fail(path);
            return result;
        }
        let mut vector = Vec::with_capacity(dim);
        for slot in bytes[cursor..cursor + dim * 4].chunks_exact(4) {
            vector.push(f32::from_le_bytes(slot.try_into().unwrap_or([0; 4])));
        }
        cursor += dim * 4;
        result.insert(id.to_string(), vector);
    }
    result
}

fn load_index(repo_path: &str) -> AppResult<Option<RepoIndex>> {
    let path = index_path(repo_path)?;
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(&path)?.len() > MAX_INDEX_BYTES {
        return Err(AppError::Config(
            "Code index exceeds its storage limit; delete and rebuild it".into(),
        ));
    }
    // Sealed with DPAPI on Windows; legacy plaintext passes through and is
    // re-sealed on the next save.
    let raw = fs::read(path)?;
    let bytes = crate::crypto::decrypt_at_rest(&raw)?;
    let mut value: RepoIndex = serde_json::from_slice(&bytes)?;
    if value.version != FORMAT_VERSION || value.repo_path != repo_path {
        return Ok(None);
    }
    // Older builds kept the vectors inline in the JSON (serde default keeps
    // those loading); fresh saves carry them in the binary sidecar instead.
    let embeddings = read_embeddings(&embeddings_path(repo_path)?);
    if !embeddings.is_empty() {
        for chunk in &mut value.chunks {
            if let Some(vector) = embeddings.get(&chunk.id) {
                chunk.embedding = vector.clone();
            }
        }
    }
    Ok(Some(value))
}

fn save_index(index: &RepoIndex) -> AppResult<()> {
    // Strip vectors out of the JSON payload — serializing millions of f32
    // values as text is what pushed the index into its size cap.
    let mut stripped = index.clone();
    for chunk in &mut stripped.chunks {
        chunk.embedding = Vec::new();
    }
    let bytes = serde_json::to_vec(&stripped)?;
    if bytes.len() as u64 > MAX_INDEX_BYTES {
        return Err(AppError::Config(
            "Code index exceeds the 128 MiB storage limit".into(),
        ));
    }
    let sealed = crate::crypto::encrypt_at_rest(&bytes);
    AtomicFile::new(index_path(&index.repo_path)?, AllowOverwrite)
        .write(|file| {
            file.write_all(&sealed)?;
            file.flush()?;
            file.sync_all()
        })
        .map_err(|e| AppError::Config(format!("Failed to save code index atomically: {e}")))?;
    write_embeddings(&embeddings_path(&index.repo_path)?, &index.chunks)
}

fn embedding_key(config: &AppConfig) -> String {
    let c = &config.index;
    format!(
        "{}:{}",
        c.embedding_provider,
        if c.embedding_provider == "ollama" {
            &c.ollama_embedding_model
        } else {
            &c.cloud_embedding_model
        }
    )
}

fn exclusion_key(config: &IndexConfig) -> String {
    let fields = config.extra_excludes.iter().map(String::as_str).chain([
        if config.include_untracked {
            "untracked"
        } else {
            "tracked-only"
        },
        TOKENIZER_VERSION,
    ]);
    digest_fields(fields)
}

fn is_sensitive(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or("");
    name == ".env"
        || name.starts_with(".env.")
        || name.contains("credential")
        || name.contains("secret")
        || [
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            ".jks",
            ".keystore",
            ".crt",
            ".cer",
            ".der",
        ]
        .iter()
        .any(|e| name.ends_with(e))
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let (p, v) = (pattern.as_bytes(), value.as_bytes());
    let (mut pi, mut vi, mut star, mut mark) = (0, 0, None, 0);
    while vi < v.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == v[vi]) {
            pi += 1;
            vi += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = Some(pi);
            pi += 1;
            mark = vi;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            vi = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

fn excluded(path: &str, patterns: &[String]) -> bool {
    let normalized = path.replace('\\', "/");
    is_sensitive(&normalized)
        || patterns.iter().filter(|p| !p.trim().is_empty()).any(|p| {
            let p = p.trim().replace('\\', "/");
            wildcard_match(&p, &normalized)
                || normalized.split('/').any(|part| wildcard_match(&p, part))
        })
}

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn read_worktree_file(workdir: &Path, path: &str, max_file: usize) -> Option<Vec<u8>> {
    if !safe_relative(path) {
        return None;
    }
    let candidate = workdir.join(path);
    let metadata = fs::metadata(&candidate).ok()?;
    if !metadata.is_file() || metadata.len() > max_file as u64 {
        return None;
    }
    // Do not follow a repository symlink outside its worktree and accidentally index local secrets.
    let canonical_root = fs::canonicalize(workdir).ok()?;
    let canonical_file = fs::canonicalize(&candidate).ok()?;
    if !canonical_file.starts_with(canonical_root) {
        return None;
    }
    fs::read(candidate).ok()
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|b| *b == 0) || std::str::from_utf8(bytes).is_err()
}

/// Metadata fields that can be compared without reading any worktree file
/// content: HEAD, the git-index tree digest, and config-derived keys.
fn cheap_metadata(repo: &git2::Repository, config: &AppConfig) -> AppResult<CheapMeta> {
    let index = repo.index()?;
    let mut index_fields = Vec::new();
    for entry in index.iter() {
        if let Ok(path) = String::from_utf8(entry.path.clone()) {
            let stage = ((entry.flags >> 12) & 0x3) as u8;
            index_fields.push(format!("{path}\0{}\0{stage}", entry.id));
        }
    }
    drop(index);
    Ok(CheapMeta {
        head: repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|oid| oid.to_string())
            .unwrap_or_else(|| "unborn".into()),
        index_snapshot: digest_fields(index_fields.iter().map(String::as_str)),
        exclusion_key: exclusion_key(&config.index),
        embedding_key: embedding_key(config),
        tokenizer_version: TOKENIZER_VERSION.into(),
        include_untracked: config.index.include_untracked,
    })
}

#[derive(Debug, Clone, PartialEq)]
struct CheapMeta {
    head: String,
    index_snapshot: String,
    exclusion_key: String,
    embedding_key: String,
    tokenizer_version: String,
    include_untracked: bool,
}

/// Candidate files for indexing: tracked files (stage 0) plus untracked files
/// when the config asks for them. Exclusion filtering happens per-use.
fn candidate_paths(repo: &git2::Repository, config: &AppConfig) -> AppResult<BTreeSet<String>> {
    let index = repo.index()?;
    let mut tracked = BTreeSet::new();
    for entry in index.iter() {
        let stage = ((entry.flags >> 12) & 0x3) as u8;
        if stage == 0 {
            if let Ok(path) = String::from_utf8(entry.path.clone()) {
                tracked.insert(path);
            }
        }
    }
    drop(index);
    let mut paths = tracked;
    if config.index.include_untracked {
        let mut options = git2::StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        for entry in repo.statuses(Some(&mut options))?.iter() {
            if entry.status().is_wt_new() {
                if let Some(path) = entry.path() {
                    paths.insert(path.to_string());
                }
            }
        }
    }
    Ok(paths)
}

fn collect_snapshot(
    repo_path: &str,
    config: &AppConfig,
    include_contents: bool,
) -> AppResult<RepoSnapshot> {
    let repo = git::repo::open_repo(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository cannot be indexed".into()))?;
    let max_file = (config.index.max_file_bytes as usize).clamp(1024, MAX_FILE_BYTES_HARD);
    let cheap = cheap_metadata(&repo, config)?;
    let paths = candidate_paths(&repo, config)?;

    let mut file_stats = BTreeMap::new();
    let mut files = Vec::new();
    let mut worktree_fields = Vec::new();
    for path in paths {
        if excluded(&path, &config.index.extra_excludes) {
            continue;
        }
        let full_path = workdir.join(&path);
        if let Ok(metadata) = fs::metadata(&full_path) {
            if metadata.is_file() {
                file_stats.insert(path.clone(), stat_fingerprint(&metadata));
            }
        }
        let Some(bytes) = read_worktree_file(workdir, &path, max_file) else {
            continue;
        };
        if looks_binary(&bytes) {
            continue;
        }
        let content_hash = digest_bytes(&bytes);
        worktree_fields.push(format!("{path}\0{content_hash}"));
        files.push(SourceFile {
            path,
            content_hash,
            bytes: if include_contents { bytes } else { Vec::new() },
        });
    }

    let metadata = IndexMetadata {
        head: cheap.head,
        index_snapshot: cheap.index_snapshot,
        worktree_snapshot: digest_fields(worktree_fields.iter().map(String::as_str)),
        exclusion_key: cheap.exclusion_key,
        embedding_key: cheap.embedding_key,
        tokenizer_version: cheap.tokenizer_version,
        include_untracked: cheap.include_untracked,
    };
    Ok(RepoSnapshot {
        metadata,
        files,
        file_stats,
    })
}

/// Stat-only comparison of the current candidate file set against the last
/// full scan. Reads no file contents; a mismatch (file added, deleted, or
/// touched with a different mtime/size) simply falls back to the full rescan.
fn worktree_stats_unchanged(
    repo_path: &str,
    config: &AppConfig,
    cached: &BTreeMap<String, (i64, u64)>,
) -> AppResult<bool> {
    let repo = git::repo::open_repo(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository cannot be indexed".into()))?;
    let max_file = (config.index.max_file_bytes as usize).clamp(1024, MAX_FILE_BYTES_HARD);
    let mut current = BTreeMap::new();
    for path in candidate_paths(&repo, config)? {
        if excluded(&path, &config.index.extra_excludes) {
            continue;
        }
        let metadata = match fs::metadata(workdir.join(&path)) {
            Ok(metadata) if metadata.is_file() && metadata.len() <= max_file as u64 => metadata,
            Ok(_) => continue,
            Err(_) => return Ok(false), // file vanished since the last scan
        };
        current.insert(path, stat_fingerprint(&metadata));
    }
    Ok(current == *cached)
}

fn stale_reason(
    index: &RepoIndex,
    repo_path: &str,
    config: &AppConfig,
) -> AppResult<Option<String>> {
    const STALE_MESSAGE: &str = "Code index is stale because HEAD, index/worktree contents, exclusions, untracked-file policy, or embedding model changed; rebuild the index";

    // 1) Cheap fields first: HEAD, git-index tree and config keys. None of
    //    these read worktree file contents, so mismatches cost almost nothing.
    let cheap = cheap_metadata(&git::repo::open_repo(repo_path)?, config)?;
    let stored = &index.metadata;
    if cheap.head != stored.head
        || cheap.index_snapshot != stored.index_snapshot
        || cheap.exclusion_key != stored.exclusion_key
        || cheap.embedding_key != stored.embedding_key
        || cheap.tokenizer_version != stored.tokenizer_version
        || cheap.include_untracked != stored.include_untracked
    {
        return Ok(Some(STALE_MESSAGE.into()));
    }

    // 2) Stat-only fast path: compare per-file (mtime, size) against the last
    //    full scan. Status queries on an unchanged worktree stop here instead
    //    of re-reading and re-hashing every file.
    if let Ok(cache) = worktree_cache().lock() {
        if let Some(cached) = cache.get(repo_path) {
            if worktree_stats_unchanged(repo_path, config, &cached.files)? {
                return Ok(if cached.snapshot == stored.worktree_snapshot {
                    None
                } else {
                    Some(STALE_MESSAGE.into())
                });
            }
        }
    }

    // 3) Full rescan: read + hash every candidate file, then refresh the
    //    stat cache for the next round.
    let current = collect_snapshot(repo_path, config, false)?;
    if let Ok(mut cache) = worktree_cache().lock() {
        cache.insert(
            repo_path.to_string(),
            WorktreeFingerprint {
                snapshot: current.metadata.worktree_snapshot.clone(),
                files: current.file_stats,
            },
        );
    }
    if current.metadata == index.metadata {
        Ok(None)
    } else {
        Ok(Some(STALE_MESSAGE.into()))
    }
}

fn language(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "java" => "java",
        "go" => "go",
        "c" | "h" => "c",
        "cc" | "cpp" | "hpp" => "cpp",
        "cs" => "csharp",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "json" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" => "markdown",
        "html" => "html",
        "css" | "scss" => "css",
        "sh" | "bash" => "shell",
        _ => "text",
    }
    .into()
}

fn symbols(lines: &[&str]) -> Vec<String> {
    let mut found = Vec::new();
    for line in lines {
        let t = line.trim_start();
        for marker in [
            "fn ",
            "struct ",
            "enum ",
            "trait ",
            "class ",
            "interface ",
            "function ",
            "def ",
            "func ",
        ] {
            if let Some(rest) = t
                .strip_prefix(marker)
                .or_else(|| t.strip_prefix("pub ").and_then(|x| x.strip_prefix(marker)))
            {
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() && !found.contains(&name) {
                    found.push(name);
                }
            }
        }
        if found.len() >= 16 {
            break;
        }
    }
    found
}

fn chunk_file(
    path: &str,
    content_hash: &str,
    content: &str,
    target_lines: usize,
    overlap: usize,
) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return vec![];
    }
    let target = target_lines.clamp(20, 400);
    let overlap = overlap.min(target / 2);
    let mut output = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let end = (start + target).min(lines.len());
        let text = lines[start..end].join("\n");
        let id = format!("{content_hash}:{}:{end}:{}", start + 1, language(path));
        output.push(CodeChunk {
            id,
            path: path.into(),
            blob_oid: content_hash.into(),
            start_line: (start + 1) as u32,
            end_line: end as u32,
            language: language(path),
            symbols: symbols(&lines[start..end]),
            text,
            embedding: vec![],
        });
        if end == lines.len() {
            break;
        }
        start = end - overlap;
    }
    output
}

fn reuse_cached_embeddings(
    chunks: &mut [CodeChunk],
    reusable: &HashMap<String, CodeChunk>,
) -> usize {
    let mut reused = 0;
    for chunk in chunks {
        if let Some(cached) = reusable.get(&chunk.id) {
            chunk.embedding = cached.embedding.clone();
            reused += 1;
        }
    }
    reused
}

fn terms(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| s.chars().count() >= 2)
        .map(|s| s.to_lowercase())
        .collect()
}

fn build_postings(chunks: &[CodeChunk]) -> BTreeMap<String, Vec<u32>> {
    let mut postings: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for (ordinal, chunk) in chunks.iter().enumerate() {
        let searchable = format!("{} {} {}", chunk.path, chunk.symbols.join(" "), chunk.text);
        for term in terms(&searchable) {
            postings.entry(term).or_default().push(ordinal as u32);
        }
    }
    postings
}

async fn embed_batch(
    config: &AppConfig,
    texts: &[String],
    api_key: Option<&str>,
) -> AppResult<Vec<Vec<f32>>> {
    let c = &config.index;
    let (url, model, provider) = if c.embedding_provider == "ollama" {
        (
            format!(
                "{}/api/embed",
                c.ollama_embedding_base_url.trim_end_matches('/')
            ),
            c.ollama_embedding_model.as_str(),
            "Ollama",
        )
    } else if c.embedding_provider == "openai_compatible"
        && c.cloud_embedding_enabled
        && !c.never_upload_index
    {
        (
            format!(
                "{}/embeddings",
                c.cloud_embedding_base_url.trim_end_matches('/')
            ),
            c.cloud_embedding_model.as_str(),
            "OpenAI-compatible embedding",
        )
    } else {
        return Err(AppError::Ai("Cloud embedding requires explicit enablement and disabling 'never upload index content'".into()));
    };
    let mut request = http_client()?
        .post(&url)
        .json(&serde_json::json!({"model": model, "input": texts}));
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        return Err(upstream_error(provider, response).await);
    }
    let json = read_json_limited(response).await?;
    let arrays = if provider == "Ollama" {
        json.get("embeddings").and_then(|v| v.as_array())
    } else {
        json.get("data").and_then(|v| v.as_array())
    }
    .ok_or_else(|| AppError::AiResponse("Embedding service returned no vectors".into()))?;
    let mut result = Vec::new();
    for item in arrays {
        let values = if provider == "Ollama" {
            item.as_array()
        } else {
            item.get("embedding").and_then(|v| v.as_array())
        }
        .ok_or_else(|| AppError::AiResponse("Embedding vector is invalid".into()))?;
        let vector: Vec<f32> = values
            .iter()
            .map(|v| {
                v.as_f64()
                    .map(|x| x as f32)
                    .ok_or_else(|| AppError::AiResponse("Embedding contains a non-number".into()))
            })
            .collect::<AppResult<_>>()?;
        if vector.is_empty() || vector.len() > 16_384 {
            return Err(AppError::AiResponse(
                "Embedding dimensions are invalid".into(),
            ));
        }
        result.push(vector);
    }
    if result.len() != texts.len() {
        return Err(AppError::AiResponse(
            "Embedding count does not match input".into(),
        ));
    }
    Ok(result)
}

impl IndexManager {
    fn update(&self, repo: &str, generation: u64, f: impl FnOnce(&mut IndexStatus)) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(job) = jobs
                .get_mut(repo)
                .filter(|job| job.generation == generation)
            {
                f(&mut job.status);
                job.status.updated_at = now();
            }
        }
    }

    fn is_current(&self, repo: &str, generation: u64) -> bool {
        self.jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(repo).map(|job| job.generation == generation))
            .unwrap_or(false)
    }

    fn save_if_current(&self, repo: &str, generation: u64, index: &RepoIndex) -> AppResult<bool> {
        // The disk write can take seconds (up to the 128 MiB index cap), so it
        // must not run while holding the jobs lock — that would stall status,
        // cancel and rebuild for the whole write. Check the generation first,
        // write unlocked, then re-check so a cancel that raced the write is
        // still reported as not-current.
        if !self.is_current(repo, generation) {
            return Ok(false);
        }
        save_index(index)?;
        Ok(self.is_current(repo, generation))
    }

    pub fn status(&self, repo: &str) -> AppResult<IndexStatus> {
        if let Ok(jobs) = self.jobs.lock() {
            if let Some(job) = jobs.get(repo) {
                if matches!(
                    job.status.phase,
                    IndexPhase::Scanning | IndexPhase::Embedding
                ) {
                    return Ok(job.status.clone());
                }
            }
        }
        let Some(index) = load_index(repo)? else {
            return Ok(self
                .jobs
                .lock()
                .ok()
                .and_then(|jobs| jobs.get(repo).map(|job| job.status.clone()))
                .unwrap_or_default());
        };
        let config = AppConfig::load(&SystemCredentialStore)?;
        let stale = stale_reason(&index, repo, &config)?;
        Ok(IndexStatus {
            phase: IndexPhase::Ready,
            chunks: index.chunks.len(),
            stale: stale.is_some(),
            message: stale,
            updated_at: index.updated_at,
            ..Default::default()
        })
    }

    pub fn cancel(&self, repo: &str) -> bool {
        let Ok(mut jobs) = self.jobs.lock() else {
            return false;
        };
        let Some(job) = jobs.get_mut(repo) else {
            return false;
        };
        job.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
        job.generation = job.generation.wrapping_add(1);
        job.status.phase = IndexPhase::Cancelled;
        job.status.message = Some("Index build cancelled".into());
        job.status.updated_at = now();
        true
    }

    pub fn delete(&self, repo: &str) -> AppResult<bool> {
        let _ = self.cancel(repo);
        let path = index_path(repo)?;
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn rebuild(&self, repo_path: &str, force: bool) -> AppResult<IndexStatus> {
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let generation;
        {
            let mut jobs = self
                .jobs
                .lock()
                .map_err(|_| AppError::General("Index manager unavailable".into()))?;
            if jobs.get(repo_path).is_some_and(|j| {
                matches!(j.status.phase, IndexPhase::Scanning | IndexPhase::Embedding)
            }) {
                return Err(AppError::General("Indexing is already running".into()));
            }
            generation = jobs
                .get(repo_path)
                .map_or(1, |job| job.generation.wrapping_add(1));
            jobs.insert(
                repo_path.into(),
                JobState {
                    generation,
                    status: IndexStatus {
                        phase: IndexPhase::Scanning,
                        ..Default::default()
                    },
                    cancelled: cancel.clone(),
                },
            );
        }
        let result = self
            .rebuild_inner(repo_path, force, generation, &cancel)
            .await;
        match result {
            Ok(status) => Ok(status),
            Err(e) => {
                self.update(repo_path, generation, |s| {
                    s.phase = IndexPhase::Failed;
                    s.message = Some(e.to_string());
                });
                Err(e)
            }
        }
    }

    async fn rebuild_inner(
        &self,
        repo_path: &str,
        force: bool,
        generation: u64,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> AppResult<IndexStatus> {
        let config = AppConfig::load(&SystemCredentialStore)?;
        if !config.index.enabled {
            return Err(AppError::Config(
                "Code indexing is disabled in Settings".into(),
            ));
        }
        let snapshot = collect_snapshot(repo_path, &config, true)?;
        self.update(repo_path, generation, |s| {
            s.files_total = snapshot.files.len()
        });
        let reusable: HashMap<String, CodeChunk> = if force {
            HashMap::new()
        } else {
            load_index(repo_path)?
                .filter(|index| index.metadata.embedding_key == snapshot.metadata.embedding_key)
                .into_iter()
                .flat_map(|index| index.chunks)
                .map(|chunk| (chunk.id.clone(), chunk))
                .collect()
        };
        let max_chunks = (config.index.max_chunks as usize).clamp(1, MAX_CHUNKS_HARD);
        let mut chunks = Vec::new();
        for source in snapshot.files {
            if cancel.load(std::sync::atomic::Ordering::Acquire)
                || !self.is_current(repo_path, generation)
            {
                return self.status(repo_path);
            }
            let text = std::str::from_utf8(&source.bytes).unwrap_or_default();
            let mut file_chunks = chunk_file(
                &source.path,
                &source.content_hash,
                text,
                config.index.chunk_lines as usize,
                config.index.chunk_overlap as usize,
            );
            let reused = reuse_cached_embeddings(&mut file_chunks, &reusable);
            self.update(repo_path, generation, |s| s.reused_chunks += reused);
            for chunk in file_chunks {
                chunks.push(chunk);
                if chunks.len() >= max_chunks {
                    break;
                }
            }
            self.update(repo_path, generation, |s| {
                s.files_processed += 1;
                s.chunks = chunks.len();
            });
            if chunks.len() >= max_chunks {
                break;
            }
        }

        self.update(repo_path, generation, |s| s.phase = IndexPhase::Embedding);
        let api_key = if config.index.embedding_provider == "openai_compatible" {
            SystemCredentialStore.get("embedding_openai")?
        } else {
            None
        };
        let missing: Vec<usize> = chunks
            .iter()
            .enumerate()
            .filter(|(_, c)| c.embedding.is_empty())
            .map(|(i, _)| i)
            .collect();
        for batch in missing.chunks(EMBEDDING_BATCH) {
            if cancel.load(std::sync::atomic::Ordering::Acquire)
                || !self.is_current(repo_path, generation)
            {
                return self.status(repo_path);
            }
            let texts: Vec<String> = batch
                .iter()
                .map(|i| {
                    chunks[*i]
                        .text
                        .chars()
                        .take(config.index.max_embedding_chars as usize)
                        .collect()
                })
                .collect();
            let vectors = embed_batch(&config, &texts, api_key.as_deref()).await?;
            for (index, vector) in batch.iter().zip(vectors) {
                chunks[*index].embedding = vector;
            }
        }

        let postings = build_postings(&chunks);
        let stored = RepoIndex {
            version: FORMAT_VERSION,
            repo_path: repo_path.into(),
            metadata: snapshot.metadata,
            updated_at: now(),
            chunks,
            postings,
        };
        if cancel.load(std::sync::atomic::Ordering::Acquire)
            || !self.save_if_current(repo_path, generation, &stored)?
        {
            return self.status(repo_path);
        }
        self.update(repo_path, generation, |s| {
            s.phase = IndexPhase::Ready;
            s.chunks = stored.chunks.len();
            s.stale = false;
            s.message = None;
        });
        self.status(repo_path)
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        aa += x * x;
        bb += y * y;
    }
    if aa == 0.0 || bb == 0.0 {
        0.0
    } else {
        dot / (aa.sqrt() * bb.sqrt())
    }
}

pub async fn search(repo_path: &str, query: &str, top_k: usize) -> AppResult<Vec<SearchHit>> {
    let Some(index) = load_index(repo_path)? else {
        return Err(AppError::Config(
            "No code index exists for this repository; build it in Settings".into(),
        ));
    };
    let config = AppConfig::load(&SystemCredentialStore)?;
    if let Some(reason) = stale_reason(&index, repo_path, &config)? {
        return Err(AppError::Config(reason));
    }
    let api_key = if config.index.embedding_provider == "openai_compatible" {
        SystemCredentialStore.get("embedding_openai")?
    } else {
        None
    };
    let query_vector = embed_batch(
        &config,
        &[query
            .chars()
            .take(config.index.max_embedding_chars as usize)
            .collect()],
        api_key.as_deref(),
    )
    .await
    .ok()
    .and_then(|mut vectors| vectors.pop());
    let query_terms = terms(query);
    let mut lexical_counts: HashMap<usize, usize> = HashMap::new();
    for term in &query_terms {
        if let Some(postings) = index.postings.get(term) {
            for ordinal in postings {
                *lexical_counts.entry(*ordinal as usize).or_default() += 1;
            }
        }
    }

    let mut scored = Vec::new();
    for (ordinal, chunk) in index.chunks.into_iter().enumerate() {
        let lexical = if query_terms.is_empty() {
            0.0
        } else {
            lexical_counts.get(&ordinal).copied().unwrap_or(0) as f32 / query_terms.len() as f32
        };
        let vector = query_vector
            .as_deref()
            .map(|query| cosine(query, &chunk.embedding))
            .unwrap_or(0.0);
        let score = vector * 0.7 + lexical * 0.3;
        if score > 0.01 {
            scored.push((score, chunk));
        }
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
    Ok(scored
        .into_iter()
        .take(top_k.clamp(1, 20))
        .map(|(score, c)| SearchHit {
            path: c.path,
            start_line: c.start_line,
            end_line: c.end_line,
            language: c.language,
            symbols: c.symbols,
            score,
            text: c.text,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_secrets_binaries_and_patterns() {
        assert!(excluded("config/.env.prod", &[]));
        assert!(excluded("src/generated/api.ts", &["**/generated/*".into()]));
        assert!(looks_binary(b"abc\0def"));
        assert!(!looks_binary("代码".as_bytes()));
    }

    #[test]
    fn chunks_preserve_lines_language_and_symbols() {
        let text = (1..=55)
            .map(|i| {
                if i == 3 {
                    "fn hello() {}".into()
                } else {
                    format!("line {i}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let c = chunk_file("src/lib.rs", "abc", &text, 20, 5);
        assert_eq!(c[0].start_line, 1);
        assert_eq!(c[0].end_line, 20);
        assert_eq!(c[1].start_line, 16);
        assert_eq!(c[0].language, "rust");
        assert!(c[0].symbols.contains(&"hello".into()));
    }

    #[test]
    fn content_hash_forms_incremental_identity() {
        let a = chunk_file("a.rs", "hash1", "fn a() {}", 20, 0);
        let b = chunk_file("a.rs", "hash2", "fn a() {}", 20, 0);
        assert_ne!(a[0].id, b[0].id);
    }

    #[test]
    fn incremental_reuse_requires_exact_content_identity() {
        let mut current = chunk_file("src/lib.rs", "same-hash", "fn current() {}", 20, 0);
        let mut cached = current[0].clone();
        cached.embedding = vec![0.25, 0.75];
        let reusable = HashMap::from([(cached.id.clone(), cached)]);
        assert_eq!(reuse_cached_embeddings(&mut current, &reusable), 1);
        let mut changed = chunk_file("src/lib.rs", "new-hash", "fn current() {}", 20, 0);
        assert_eq!(reuse_cached_embeddings(&mut changed, &reusable), 0);
    }

    #[test]
    fn persistent_postings_reference_only_matching_chunks() {
        let chunks = vec![
            chunk_file("a.rs", "one", "fn alpha() {}", 20, 0).remove(0),
            chunk_file("b.rs", "two", "fn beta() {}", 20, 0).remove(0),
        ];
        let postings = build_postings(&chunks);
        assert_eq!(postings.get("alpha"), Some(&vec![0]));
        assert_eq!(postings.get("beta"), Some(&vec![1]));
        assert!(!postings.contains_key("missing"));
    }

    #[test]
    fn cancelled_generation_cannot_write_an_index() {
        let manager = IndexManager::default();
        let repo = "test-generation-repo";
        manager.jobs.lock().unwrap().insert(
            repo.into(),
            JobState {
                generation: 2,
                status: IndexStatus::default(),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            },
        );
        let index = RepoIndex {
            version: FORMAT_VERSION,
            repo_path: repo.into(),
            metadata: IndexMetadata {
                head: "head".into(),
                index_snapshot: "index".into(),
                worktree_snapshot: "worktree".into(),
                exclusion_key: "exclude".into(),
                embedding_key: "model".into(),
                tokenizer_version: TOKENIZER_VERSION.into(),
                include_untracked: true,
            },
            updated_at: now(),
            chunks: vec![],
            postings: BTreeMap::new(),
        };
        assert!(!manager.save_if_current(repo, 1, &index).unwrap());
    }

    #[test]
    fn safe_relative_rejects_escape_and_absolute_paths() {
        assert!(safe_relative("src/lib.rs"));
        assert!(!safe_relative("../secret"));
        assert!(!safe_relative("/etc/passwd"));
    }

    #[test]
    fn filters_nested_patterns_case_insensitive_secrets_and_invalid_utf8() {
        assert!(excluded("nested/.ENV.Local", &[]));
        assert!(excluded("src/vendor/generated.ts", &["vendor".into()]));
        assert!(excluded("src/app.min.js", &["*.min.js".into()]));
        assert!(looks_binary(&[0xff, 0xfe, 0xfd]));
    }

    #[test]
    fn lexical_terms_support_code_identifiers_and_unicode() {
        assert!(terms("find repo_path 代码索引").contains("repo_path"));
        assert!(terms("find repo_path 代码索引").contains("代码索引"));
    }

    fn embedding_chunk(id: &str, embedding: Vec<f32>) -> CodeChunk {
        CodeChunk {
            id: id.into(),
            path: "a.rs".into(),
            blob_oid: "hash".into(),
            start_line: 1,
            end_line: 2,
            language: "rust".into(),
            symbols: vec![],
            text: "x".into(),
            embedding,
        }
    }

    #[test]
    fn embeddings_sidecar_roundtrips_as_binary() {
        let root = std::env::temp_dir().join(format!("aigit-emb-{}", now()));
        fs::create_dir_all(&root).expect("temp dir");
        let path = root.join("embeddings.bin");
        let chunks = vec![
            embedding_chunk("chunk-a", vec![0.25, -0.5, 1.0]),
            embedding_chunk("chunk-b", vec![]),
        ];

        write_embeddings(&path, &chunks).expect("write sidecar");
        let restored = read_embeddings(&path);
        assert_eq!(restored.get("chunk-a"), Some(&vec![0.25, -0.5, 1.0]));
        assert!(!restored.contains_key("chunk-b"));

        // A rebuild without embeddings must not leave a stale sidecar behind.
        let empty = vec![embedding_chunk("chunk-a", vec![])];
        write_embeddings(&path, &empty).expect("write empty sidecar");
        assert!(!path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_embeddings_sidecar_is_quarantined() {
        let root = std::env::temp_dir().join(format!("aigit-emb-bad-{}", now()));
        fs::create_dir_all(&root).expect("temp dir");
        let path = root.join("embeddings.bin");
        fs::write(&path, b"AIGITEB1 garbage-not-a-record").expect("seed corrupt file");

        let restored = read_embeddings(&path);
        assert!(restored.is_empty());
        assert!(!path.exists(), "corrupt sidecar must be moved aside");
        assert!(fs::read_dir(&root)
            .expect("list temp dir")
            .any(|entry| entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .starts_with("embeddings.corrupt-")));
        let _ = fs::remove_dir_all(root);
    }
}
