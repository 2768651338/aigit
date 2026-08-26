use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use git2::Repository;
use reqwest::{header, Client, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::config::{CredentialStore, SystemCredentialStore};
use crate::error::{AppError, AppResult};

const GH_TIMEOUT: Duration = Duration::from_secs(120);
const API_VERSION: &str = "2022-11-28";
const USER_AGENT: &str = "aigit-desktop";
const MAX_PROCESS_OUTPUT: usize = 1024 * 1024;
const MAX_ERROR_OUTPUT: usize = 16 * 1024;

fn sanitize_external_output(value: &str) -> String {
    let url_credentials = regex::Regex::new(r"(?i)(https?://)[^\s/@:]+(?::[^\s/@]*)?@")
        .expect("credential URL regex");
    let sensitive = regex::Regex::new(
        r"(?i)\b(authorization|token|password|passwd|api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)",
    )
    .expect("sensitive field regex");
    let value = url_credentials.replace_all(value, "$1[REDACTED]@");
    let safe = sensitive.replace_all(&value, "$1=[REDACTED]");
    safe.chars().take(MAX_ERROR_OUTPUT).collect()
}

fn read_process_output(mut reader: impl Read) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = reader
        .by_ref()
        .take((MAX_PROCESS_OUTPUT + 1) as u64)
        .read_to_end(&mut bytes);
    bytes.truncate(MAX_PROCESS_OUTPUT);
    bytes
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubRemote {
    pub remote_name: String,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub web_base_url: String,
    pub api_base_url: String,
    pub is_enterprise: bool,
}

impl GitHubRemote {
    pub fn repository(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
    pub fn web_url(&self) -> String {
        format!("{}/{}/{}", self.web_base_url, self.owner, self.repo)
    }
    pub fn compare_url(&self, base: &str, head: &str) -> AppResult<String> {
        validate_ref(base)?;
        validate_ref(head)?;
        let mut url = Url::parse(&format!("{}/compare/", self.web_url()))
            .map_err(|e| AppError::General(format!("Invalid GitHub URL: {e}")))?;
        url.path_segments_mut()
            .map_err(|_| AppError::General("Invalid GitHub base URL".into()))?
            .pop_if_empty()
            .push(&format!("{}...{}", base, head));
        url.query_pairs_mut().append_pair("expand", "1");
        Ok(url.into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub draft: bool,
    pub url: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub created_at: String,
    pub updated_at: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub changed_files: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequestDetail {
    pub pull_request: PullRequest,
    pub checks: Vec<CheckRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePullRequest {
    pub title: String,
    pub body: String,
    pub base: String,
    pub head: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResult {
    pub pull_request: Option<PullRequest>,
    pub opened_url: Option<String>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InlineCommentRequest {
    pub pull_number: u64,
    pub report_id: String,
    pub finding_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone)]
pub struct PullRequestSnapshot {
    pub head_sha: String,
    pub files: Vec<PullRequestFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PullRequestFile {
    pub filename: String,
    pub patch: Option<String>,
}

pub fn validate_inline_target(
    snapshot: &PullRequestSnapshot,
    expected_commit: &str,
    path: &str,
    line: u32,
) -> AppResult<()> {
    if snapshot.head_sha != expected_commit {
        return Err(AppError::General(
            "The pull request HEAD no longer matches the reviewed snapshot".into(),
        ));
    }
    let file = snapshot
        .files
        .iter()
        .find(|file| file.filename == path)
        .ok_or_else(|| {
            AppError::General("The reviewed file is not in the pull request diff".into())
        })?;
    let patch = file.patch.as_deref().ok_or_else(|| {
        AppError::General("GitHub did not provide a verifiable text patch for this file".into())
    })?;
    if !patch_contains_right_line(patch, line) {
        return Err(AppError::General(
            "The reviewed line is not an added or context line in the pull request diff".into(),
        ));
    }
    Ok(())
}

fn patch_contains_right_line(patch: &str, target: u32) -> bool {
    let mut new_line = None;
    for row in patch.lines() {
        if row.starts_with("@@") {
            new_line = parse_hunk_new_start(row);
            continue;
        }
        let Some(current) = new_line else { continue };
        if row.starts_with('+') || row.starts_with(' ') {
            if current == target {
                return true;
            }
            new_line = current.checked_add(1);
        } else if !row.starts_with('-') && !row.starts_with('\\') {
            new_line = None;
        }
    }
    false
}

fn parse_hunk_new_start(header: &str) -> Option<u32> {
    let range = header
        .split_whitespace()
        .find(|part| part.starts_with('+'))?;
    range
        .trim_start_matches('+')
        .split(',')
        .next()?
        .parse()
        .ok()
}

pub fn parse_remote_url(remote_name: &str, value: &str) -> AppResult<GitHubRemote> {
    let value = value.trim();
    let (host, path) = if let Ok(url) = Url::parse(value) {
        match url.scheme() {
            "http" | "https" | "ssh" | "git" => {}
            _ => {
                return Err(AppError::General(
                    "Unsupported GitHub remote URL scheme".into(),
                ))
            }
        }
        if matches!(url.scheme(), "http" | "https")
            && (!url.username().is_empty() || url.password().is_some())
        {
            return Err(AppError::General(
                "GitHub HTTP remote URL must not contain credentials".into(),
            ));
        }
        let host = url
            .host_str()
            .ok_or_else(|| AppError::General("GitHub remote URL has no host".into()))?;
        (
            host.to_string(),
            url.path().trim_start_matches('/').to_string(),
        )
    } else {
        let without_user = value
            .strip_prefix("git@")
            .or_else(|| value.split_once('@').map(|(_, rest)| rest))
            .ok_or_else(|| {
                AppError::General("Not a supported GitHub HTTPS/SSH remote URL".into())
            })?;
        let (host, path) = without_user
            .split_once(':')
            .ok_or_else(|| AppError::General("Invalid SCP-style GitHub remote URL".into()))?;
        (host.to_string(), path.to_string())
    };
    if host.is_empty() || host.contains('/') || host.contains('\\') {
        return Err(AppError::General("Invalid GitHub host".into()));
    }
    let path = path.trim_matches('/').trim_end_matches(".git");
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let owner = parts
        .next()
        .ok_or_else(|| AppError::General("GitHub remote URL is missing owner".into()))?;
    let repo = parts
        .next()
        .ok_or_else(|| AppError::General("GitHub remote URL is missing repository".into()))?;
    if parts.next().is_some() || !valid_slug(owner) || !valid_slug(repo) {
        return Err(AppError::General(
            "GitHub remote must have exactly owner/repository path components".into(),
        ));
    }
    let is_enterprise = !host.eq_ignore_ascii_case("github.com");
    Ok(GitHubRemote {
        remote_name: remote_name.into(),
        host: host.clone(),
        owner: owner.into(),
        repo: repo.into(),
        web_base_url: format!("https://{host}"),
        api_base_url: if is_enterprise {
            format!("https://{host}/api/v3")
        } else {
            "https://api.github.com".into()
        },
        is_enterprise,
    })
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}
fn validate_ref(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 255
        || value.contains(['\0', '\n', '\r'])
        || value.starts_with('-')
    {
        Err(AppError::General(
            "Invalid Git reference for GitHub operation".into(),
        ))
    } else {
        Ok(())
    }
}

pub fn discover(repo: &Repository, preferred: Option<&str>) -> AppResult<GitHubRemote> {
    let names = repo.remotes()?;
    let ordered = preferred
        .into_iter()
        .chain(["origin", "upstream"])
        .chain(names.iter().flatten());
    let mut last_error = None;
    for name in ordered {
        if let Ok(remote) = repo.find_remote(name) {
            if let Some(url) = remote.pushurl().or_else(|| remote.url()) {
                match parse_remote_url(name, url) {
                    Ok(parsed) => return Ok(parsed),
                    Err(e) => last_error = Some(e),
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::General("No GitHub remote found".into())))
}

fn run_gh_process(
    workdir: &Path,
    args: &[String],
    timeout: Duration,
) -> AppResult<(bool, String, String)> {
    // 安全边界：只执行编译期字面量二进制 "gh"，参数以 argv 数组逐个传递，
    // 全程不经过 shell，仓库内容无法注入或篡改命令。
    // CREATE_NO_WINDOW（仅 Windows）：抑制 GUI 进程派生 CLI 时的控制台窗口闪烁。
    let mut command = Command::new("gh");
    command
        .args(args)
        .current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AppError::General(format!("gh is not available: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::General("Cannot capture command output".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::General("Cannot capture command error".into()))?;
    let out = thread::spawn(move || read_process_output(stdout));
    let err = thread::spawn(move || read_process_output(stderr));
    let start = Instant::now();
    let status = loop {
        match child.try_wait()? {
            Some(s) => break s,
            None if start.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::General("gh command timed out".to_string()));
            }
        }
    };
    Ok((
        status.success(),
        sanitize_external_output(&String::from_utf8_lossy(&out.join().unwrap_or_default())),
        sanitize_external_output(&String::from_utf8_lossy(&err.join().unwrap_or_default())),
    ))
}

pub fn gh_status(workdir: &Path, host: &str) -> GhStatus {
    let version_args = vec!["--version".into()];
    let Ok((ok, version, _)) = run_gh_process(workdir, &version_args, Duration::from_secs(10))
    else {
        return GhStatus {
            installed: false,
            authenticated: false,
            version: None,
            error: Some("GitHub CLI was not found in PATH".into()),
        };
    };
    if !ok {
        return GhStatus {
            installed: false,
            authenticated: false,
            version: None,
            error: Some("GitHub CLI could not be executed".into()),
        };
    }
    let auth_args = vec![
        "auth".into(),
        "status".into(),
        "--hostname".into(),
        host.into(),
    ];
    match run_gh_process(workdir, &auth_args, Duration::from_secs(15)) {
        Ok((true, _, _)) => GhStatus {
            installed: true,
            authenticated: true,
            version: version.lines().next().map(str::to_owned),
            error: None,
        },
        Ok((false, _, error)) => GhStatus {
            installed: true,
            authenticated: false,
            version: version.lines().next().map(str::to_owned),
            error: Some(error.trim().into()),
        },
        Err(e) => GhStatus {
            installed: true,
            authenticated: false,
            version: version.lines().next().map(str::to_owned),
            error: Some(e.to_string()),
        },
    }
}

fn gh_json<T: DeserializeOwned>(workdir: &Path, args: Vec<String>) -> AppResult<T> {
    let (ok, stdout, stderr) = run_gh_process(workdir, &args, GH_TIMEOUT)?;
    if !ok {
        return Err(AppError::General(format!(
            "GitHub CLI failed: {}",
            stderr.trim()
        )));
    }
    serde_json::from_str(&stdout).map_err(AppError::from)
}

pub fn gh_list(workdir: &Path, remote: &GitHubRemote) -> AppResult<Vec<PullRequest>> {
    #[derive(Deserialize)]
    struct GhAuthor {
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GhPr {
        number: u64,
        title: String,
        body: String,
        state: String,
        is_draft: bool,
        url: String,
        author: GhAuthor,
        head_ref_name: String,
        base_ref_name: String,
        created_at: String,
        updated_at: String,
    }
    let args = vec![
        "pr".into(),
        "list".into(),
        "--repo".into(),
        remote.repository(),
        "--state".into(),
        "all".into(),
        "--limit".into(),
        "100".into(),
        "--json".into(),
        "number,title,body,state,isDraft,url,author,headRefName,baseRefName,createdAt,updatedAt"
            .into(),
    ];
    Ok(gh_json::<Vec<GhPr>>(workdir, args)?
        .into_iter()
        .map(|p| PullRequest {
            number: p.number,
            title: p.title,
            body: p.body,
            state: p.state.to_lowercase(),
            draft: p.is_draft,
            url: p.url,
            author: p.author.login,
            head: p.head_ref_name,
            base: p.base_ref_name,
            created_at: p.created_at,
            updated_at: p.updated_at,
            additions: None,
            deletions: None,
            changed_files: None,
        })
        .collect())
}

pub fn gh_view(workdir: &Path, remote: &GitHubRemote, number: u64) -> AppResult<PullRequestDetail> {
    #[derive(Deserialize)]
    struct GhAuthor {
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GhPr {
        number: u64,
        title: String,
        body: String,
        state: String,
        is_draft: bool,
        url: String,
        author: GhAuthor,
        head_ref_name: String,
        base_ref_name: String,
        created_at: String,
        updated_at: String,
        additions: u64,
        deletions: u64,
        changed_files: u64,
    }
    let args=vec!["pr".into(),"view".into(),number.to_string(),"--repo".into(),remote.repository(),"--json".into(),"number,title,body,state,isDraft,url,author,headRefName,baseRefName,createdAt,updatedAt,additions,deletions,changedFiles".into()];
    let p: GhPr = gh_json(workdir, args)?;
    let pr = PullRequest {
        number: p.number,
        title: p.title,
        body: p.body,
        state: p.state.to_lowercase(),
        draft: p.is_draft,
        url: p.url,
        author: p.author.login,
        head: p.head_ref_name,
        base: p.base_ref_name,
        created_at: p.created_at,
        updated_at: p.updated_at,
        additions: Some(p.additions),
        deletions: Some(p.deletions),
        changed_files: Some(p.changed_files),
    };
    Ok(PullRequestDetail {
        checks: gh_checks(workdir, remote, number)?,
        pull_request: pr,
    })
}

pub fn gh_checks(workdir: &Path, remote: &GitHubRemote, number: u64) -> AppResult<Vec<CheckRun>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GhCheck {
        name: String,
        state: String,
        link: String,
    }
    let args = vec![
        "pr".into(),
        "checks".into(),
        number.to_string(),
        "--repo".into(),
        remote.repository(),
        "--json".into(),
        "name,state,link".into(),
    ];
    let (ok, stdout, stderr) = run_gh_process(workdir, &args, GH_TIMEOUT)?;
    // `gh pr checks` exits non-zero when a completed check failed, while its
    // JSON output is still complete and useful to the UI.
    let rows: Vec<GhCheck> = serde_json::from_str(&stdout).map_err(|error| {
        if ok {
            AppError::Json(error)
        } else {
            AppError::General(format!("GitHub CLI checks failed: {}", stderr.trim()))
        }
    })?;
    Ok(rows
        .into_iter()
        .map(|c| CheckRun {
            name: c.name,
            status: if c.state.eq_ignore_ascii_case("pending") {
                "in_progress".into()
            } else {
                "completed".into()
            },
            conclusion: if c.state.eq_ignore_ascii_case("pending") {
                None
            } else {
                Some(c.state.to_lowercase())
            },
            details_url: Some(c.link),
        })
        .collect())
}

pub fn gh_create(
    workdir: &Path,
    remote: &GitHubRemote,
    input: &CreatePullRequest,
) -> AppResult<PullRequest> {
    validate_ref(&input.base)?;
    validate_ref(&input.head)?;
    let mut args = vec![
        "pr".into(),
        "create".into(),
        "--repo".into(),
        remote.repository(),
        "--title".into(),
        input.title.clone(),
        "--body".into(),
        input.body.clone(),
        "--base".into(),
        input.base.clone(),
        "--head".into(),
        input.head.clone(),
    ];
    if input.draft {
        args.push("--draft".into())
    }
    let (ok, stdout, stderr) = run_gh_process(workdir, &args, GH_TIMEOUT)?;
    if !ok {
        return Err(AppError::General(format!(
            "GitHub CLI failed: {}",
            stderr.trim()
        )));
    }
    let url = stdout.trim().to_string();
    let number = url
        .rsplit('/')
        .next()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    Ok(PullRequest {
        number,
        title: input.title.clone(),
        body: input.body.clone(),
        state: "open".into(),
        draft: input.draft,
        url,
        author: String::new(),
        head: input.head.clone(),
        base: input.base.clone(),
        created_at: String::new(),
        updated_at: String::new(),
        additions: None,
        deletions: None,
        changed_files: None,
    })
}

pub fn gh_checkout(workdir: &Path, remote: &GitHubRemote, number: u64) -> AppResult<String> {
    let args = vec![
        "pr".into(),
        "checkout".into(),
        number.to_string(),
        "--repo".into(),
        remote.repository(),
        "--force".into(),
    ];
    let (ok, out, err) = run_gh_process(workdir, &args, GH_TIMEOUT)?;
    if ok {
        Ok(if out.trim().is_empty() { err } else { out })
    } else {
        Err(AppError::General(format!(
            "GitHub CLI checkout failed: {}",
            err.trim()
        )))
    }
}

pub struct GitHubApi {
    client: Client,
    remote: GitHubRemote,
    token: String,
}
impl GitHubApi {
    pub fn from_store(remote: GitHubRemote) -> AppResult<Option<Self>> {
        // The single stored PAT is scoped to github.com. Never forward it to a
        // repository-controlled Enterprise host; `gh` keeps credentials per host.
        if remote.is_enterprise {
            return Ok(None);
        }
        let store = SystemCredentialStore;
        Ok(store.get("github_pat")?.map(|token| Self {
            client: Client::new(),
            remote,
            token,
        }))
    }
    fn endpoint(&self, path: &str) -> AppResult<Url> {
        Url::parse(&format!("{}{}", self.remote.api_base_url, path))
            .map_err(|e| AppError::General(format!("Invalid GitHub API URL: {e}")))
    }
    fn request(&self, method: reqwest::Method, url: Url) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .bearer_auth(&self.token)
            .header(header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .header(header::USER_AGENT, USER_AGENT)
    }
    async fn response<T: DeserializeOwned>(&self, response: reqwest::Response) -> AppResult<T> {
        let status = response.status();
        let remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let retry = response
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if status.is_success() {
            return Ok(response.json().await?);
        }
        let body = response.text().await.unwrap_or_default();
        Err(api_error(status, &remaining, &retry, &body))
    }
    pub async fn list(&self) -> AppResult<Vec<PullRequest>> {
        let mut page = 1;
        let mut all = Vec::new();
        loop {
            let mut url = self.endpoint(&format!(
                "/repos/{}/{}/pulls",
                self.remote.owner, self.remote.repo
            ))?;
            url.query_pairs_mut()
                .append_pair("state", "all")
                .append_pair("per_page", "100")
                .append_pair("page", &page.to_string());
            let batch: Vec<ApiPr> = self
                .response(self.request(reqwest::Method::GET, url).send().await?)
                .await?;
            let count = batch.len();
            all.extend(batch.into_iter().map(Into::into));
            if count < 100 {
                break;
            }
            page += 1;
            if page > 20 {
                return Err(AppError::General(
                    "GitHub pagination exceeded safety limit".into(),
                ));
            }
        }
        Ok(all)
    }
    pub async fn view(&self, number: u64) -> AppResult<PullRequestDetail> {
        let url = self.endpoint(&format!(
            "/repos/{}/{}/pulls/{number}",
            self.remote.owner, self.remote.repo
        ))?;
        let api: ApiPr = self
            .response(self.request(reqwest::Method::GET, url).send().await?)
            .await?;
        let checks = self.checks(&api.head.sha).await?;
        Ok(PullRequestDetail {
            pull_request: api.into(),
            checks,
        })
    }
    pub async fn checks(&self, sha: &str) -> AppResult<Vec<CheckRun>> {
        validate_ref(sha)?;
        #[derive(Deserialize)]
        struct Runs {
            check_runs: Vec<ApiCheck>,
        }
        let url = self.endpoint(&format!(
            "/repos/{}/{}/commits/{sha}/check-runs",
            self.remote.owner, self.remote.repo
        ))?;
        let runs: Runs = self
            .response(self.request(reqwest::Method::GET, url).send().await?)
            .await?;
        Ok(runs.check_runs.into_iter().map(Into::into).collect())
    }
    pub async fn create(&self, input: &CreatePullRequest) -> AppResult<PullRequest> {
        validate_ref(&input.base)?;
        validate_ref(&input.head)?;
        let url = self.endpoint(&format!(
            "/repos/{}/{}/pulls",
            self.remote.owner, self.remote.repo
        ))?;
        let api: ApiPr = self
            .response(
                self.request(reqwest::Method::POST, url)
                    .json(input)
                    .send()
                    .await?,
            )
            .await?;
        Ok(api.into())
    }
    pub async fn pull_request_snapshot(&self, number: u64) -> AppResult<PullRequestSnapshot> {
        let url = self.endpoint(&format!(
            "/repos/{}/{}/pulls/{number}",
            self.remote.owner, self.remote.repo
        ))?;
        let api: ApiPr = self
            .response(self.request(reqwest::Method::GET, url).send().await?)
            .await?;
        let mut page = 1;
        let mut files = Vec::new();
        loop {
            let mut url = self.endpoint(&format!(
                "/repos/{}/{}/pulls/{number}/files",
                self.remote.owner, self.remote.repo
            ))?;
            url.query_pairs_mut()
                .append_pair("per_page", "100")
                .append_pair("page", &page.to_string());
            let batch: Vec<PullRequestFile> = self
                .response(self.request(reqwest::Method::GET, url).send().await?)
                .await?;
            let count = batch.len();
            files.extend(batch);
            if count < 100 {
                break;
            }
            page += 1;
            if page > 30 {
                return Err(AppError::General(
                    "Pull request file pagination exceeded safety limit".into(),
                ));
            }
        }
        Ok(PullRequestSnapshot {
            head_sha: api.head.sha,
            files,
        })
    }
    pub async fn inline_comment(
        &self,
        pull_number: u64,
        commit_id: &str,
        path: &str,
        line: u32,
        body: &str,
    ) -> AppResult<String> {
        if body.trim().is_empty() || path.trim().is_empty() || line == 0 {
            return Err(AppError::General(
                "Inline review comment is incomplete".into(),
            ));
        }
        validate_ref(commit_id)?;
        #[derive(Serialize)]
        struct Comment<'a> {
            body: &'a str,
            commit_id: &'a str,
            path: &'a str,
            line: u32,
            side: &'static str,
        }
        #[derive(Deserialize)]
        struct Created {
            html_url: String,
        }
        let url = self.endpoint(&format!(
            "/repos/{}/{}/pulls/{pull_number}/comments",
            self.remote.owner, self.remote.repo
        ))?;
        let request_body = Comment {
            body,
            commit_id,
            path,
            line,
            side: "RIGHT",
        };
        let result: Created = self
            .response(
                self.request(reqwest::Method::POST, url)
                    .json(&request_body)
                    .send()
                    .await?,
            )
            .await?;
        Ok(result.html_url)
    }
}

#[derive(Deserialize)]
struct ApiUser {
    login: String,
}
#[derive(Deserialize)]
struct ApiRef {
    r#ref: String,
    sha: String,
}
#[derive(Deserialize)]
struct ApiPr {
    number: u64,
    title: String,
    body: Option<String>,
    state: String,
    draft: Option<bool>,
    html_url: String,
    user: ApiUser,
    head: ApiRef,
    base: ApiRef,
    created_at: String,
    updated_at: String,
    additions: Option<u64>,
    deletions: Option<u64>,
    changed_files: Option<u64>,
}
impl From<ApiPr> for PullRequest {
    fn from(p: ApiPr) -> Self {
        Self {
            number: p.number,
            title: p.title,
            body: p.body.unwrap_or_default(),
            state: p.state,
            draft: p.draft.unwrap_or(false),
            url: p.html_url,
            author: p.user.login,
            head: p.head.r#ref,
            base: p.base.r#ref,
            created_at: p.created_at,
            updated_at: p.updated_at,
            additions: p.additions,
            deletions: p.deletions,
            changed_files: p.changed_files,
        }
    }
}
#[derive(Deserialize)]
struct ApiCheck {
    name: String,
    status: String,
    conclusion: Option<String>,
    details_url: Option<String>,
}
impl From<ApiCheck> for CheckRun {
    fn from(c: ApiCheck) -> Self {
        Self {
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            details_url: c.details_url,
        }
    }
}

fn api_error(status: StatusCode, remaining: &str, retry: &str, body: &str) -> AppError {
    let message = sanitize_external_output(
        &serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("message")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| body.chars().take(300).collect()),
    );
    match status {
        StatusCode::UNAUTHORIZED => {
            AppError::Credential(format!("GitHub token was rejected: {message}"))
        }
        StatusCode::FORBIDDEN if remaining == "0" => AppError::General(format!(
            "GitHub API rate limit exceeded; retry after {retry}"
        )),
        StatusCode::FORBIDDEN => AppError::General(format!(
            "GitHub token lacks permission for this operation: {message}"
        )),
        StatusCode::NOT_FOUND => AppError::General(format!(
            "GitHub resource was not found or is not accessible: {message}"
        )),
        StatusCode::UNPROCESSABLE_ENTITY => {
            AppError::General(format!("GitHub rejected the request: {message}"))
        }
        _ => AppError::General(format!(
            "GitHub API returned HTTP {}: {message}",
            status.as_u16()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stored_dotcom_pat_is_not_forwarded_to_enterprise_hosts() {
        let remote =
            parse_remote_url("origin", "https://github.enterprise.test/acme/widget.git").unwrap();
        assert!(GitHubApi::from_store(remote).unwrap().is_none());
    }

    #[test]
    fn parses_https_ssh_and_enterprise() {
        let a = parse_remote_url("origin", "https://github.com/acme/widget.git").unwrap();
        assert_eq!(
            (a.host.as_str(), a.owner.as_str(), a.repo.as_str()),
            ("github.com", "acme", "widget")
        );
        assert_eq!(a.api_base_url, "https://api.github.com");
        let b = parse_remote_url("origin", "git@github.example.com:team/project.git").unwrap();
        assert!(b.is_enterprise);
        assert_eq!(b.api_base_url, "https://github.example.com/api/v3");
        let c = parse_remote_url("origin", "ssh://git@github.com/team/project.git").unwrap();
        assert_eq!(c.repository(), "team/project");
    }
    #[test]
    fn parses_git_protocol_ports_and_trailing_slashes() {
        let git = parse_remote_url("origin", "git://github.com/acme/widget.git/").unwrap();
        assert_eq!(git.repository(), "acme/widget");
        let port = parse_remote_url(
            "origin",
            "ssh://git@github.example.com:2222/team/project.git",
        )
        .unwrap();
        assert_eq!(port.host, "github.example.com");
        assert_eq!(port.web_url(), "https://github.example.com/team/project");
    }

    #[test]
    fn rejects_credentials_bad_slugs_and_unsafe_refs() {
        assert!(parse_remote_url("x", "https://user:secret@github.com/a/b.git").is_err());
        assert!(parse_remote_url("x", "https://github.com/a space/b.git").is_err());
        assert!(validate_ref("-danger").is_err());
        assert!(validate_ref("line\nbreak").is_err());
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_remotes() {
        assert!(parse_remote_url("x", "file:///tmp/repo").is_err());
        assert!(parse_remote_url("x", "https://github.com/a/b/extra").is_err());
        assert!(parse_remote_url("x", "https://github.com/a/b%0a").is_err());
    }
    #[test]
    fn compare_url_encodes_refs() {
        let r = parse_remote_url("origin", "https://github.com/a/b.git").unwrap();
        let url = r.compare_url("main", "feature/x").unwrap();
        assert!(url.contains("feature%2Fx"));
        assert!(url.ends_with("expand=1"));
    }
    #[test]
    fn validates_inline_comment_against_pr_head_file_and_right_side_line() {
        let snapshot = PullRequestSnapshot {
            head_sha: "abc123".into(),
            files: vec![PullRequestFile {
                filename: "src/main.rs".into(),
                patch: Some("@@ -10,2 +10,3 @@\n context\n-old\n+new\n trailing".into()),
            }],
        };
        assert!(validate_inline_target(&snapshot, "abc123", "src/main.rs", 11).is_ok());
        assert!(validate_inline_target(&snapshot, "different", "src/main.rs", 11).is_err());
        assert!(validate_inline_target(&snapshot, "abc123", "src/other.rs", 11).is_err());
        assert!(validate_inline_target(&snapshot, "abc123", "src/main.rs", 99).is_err());
    }

    #[test]
    fn rejects_deleted_only_lines_and_unverifiable_patches() {
        let deleted = PullRequestSnapshot {
            head_sha: "abc123".into(),
            files: vec![PullRequestFile {
                filename: "src/main.rs".into(),
                patch: Some("@@ -4,2 +4,1 @@\n-deleted\n context".into()),
            }],
        };
        assert!(validate_inline_target(&deleted, "abc123", "src/main.rs", 4).is_ok());
        assert!(validate_inline_target(&deleted, "abc123", "src/main.rs", 5).is_err());
        let missing_patch = PullRequestSnapshot {
            head_sha: "abc123".into(),
            files: vec![PullRequestFile {
                filename: "src/main.rs".into(),
                patch: None,
            }],
        };
        assert!(validate_inline_target(&missing_patch, "abc123", "src/main.rs", 4).is_err());
    }

    #[test]
    fn inline_comment_request_accepts_only_server_resolved_identifiers() {
        let request: InlineCommentRequest = serde_json::from_value(serde_json::json!({
            "pull_number": 7,
            "report_id": "report-1",
            "finding_id": "finding-1",
            "confirmed": true
        }))
        .unwrap();
        assert_eq!(request.report_id, "report-1");
        assert!(
            serde_json::from_value::<InlineCommentRequest>(serde_json::json!({
                "pull_number": 7,
                "report_id": "report-1",
                "finding_id": "finding-1",
                "commit_id": "attacker-controlled",
                "confirmed": true
            }))
            .is_err()
        );
    }

    #[test]
    fn sanitizes_external_credentials_and_bounds_errors() {
        let raw = format!(
            "authorization: Bearer-secret token=ghp_secret https://user:pass@example.com/ {}",
            "x".repeat(MAX_ERROR_OUTPUT + 10)
        );
        let safe = sanitize_external_output(&raw);
        assert!(!safe.contains("Bearer-secret"));
        assert!(!safe.contains("ghp_secret"));
        assert!(!safe.contains("user:pass"));
        assert!(safe.len() <= MAX_ERROR_OUTPUT);
    }

    #[test]
    fn classifies_api_errors() {
        assert!(api_error(StatusCode::UNAUTHORIZED, "", "", "bad")
            .to_string()
            .contains("token was rejected"));
        assert!(api_error(StatusCode::FORBIDDEN, "0", "60", "limit")
            .to_string()
            .contains("rate limit"));
        assert!(api_error(StatusCode::FORBIDDEN, "1", "", "denied")
            .to_string()
            .contains("lacks permission"));
    }
    #[test]
    fn gh_missing_is_reported_without_panicking() {
        let s = gh_status(Path::new("."), "github.invalid");
        if !s.installed {
            assert!(!s.authenticated);
            assert!(s.error.is_some())
        }
    }
}
