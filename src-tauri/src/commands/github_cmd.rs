use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::git;
use crate::github::{
    self, CreatePullRequest, GhStatus, GitHubApi, GitHubIssue, GitHubRemote, InlineCommentRequest,
    PullRequest, PullRequestDetail, WorkflowResult,
};
use crate::review;

fn context(
    path: &str,
    preferred_remote: Option<&str>,
) -> AppResult<(git2::Repository, GitHubRemote)> {
    let repo = git::repo::open_repo(path)?;
    let remote = github::discover(&repo, preferred_remote)?;
    Ok((repo, remote))
}

/// `gh_status` spawns up to two `gh` subprocesses (10s/15s timeouts); it must
/// run on the blocking pool so a missing or hung `gh` cannot stall a tokio
/// worker thread while the async command waits.
async fn gh_status_on_blocking_pool(workdir: &Path, host: &str) -> AppResult<GhStatus> {
    let workdir = workdir.to_path_buf();
    let host = host.to_string();
    tokio::task::spawn_blocking(move || github::gh_status(&workdir, &host))
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))
}

#[tauri::command]
pub fn github_remote(path: String, remote: Option<String>) -> AppResult<GitHubRemote> {
    let (_, remote) = context(&path, remote.as_deref())?;
    Ok(remote)
}

#[tauri::command]
pub async fn github_gh_status(path: String, remote: Option<String>) -> AppResult<GhStatus> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    tokio::task::spawn_blocking(move || Ok(github::gh_status(&workdir, &remote.host)))
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?
}

#[tauri::command]
pub fn github_open_compare(
    app: AppHandle,
    path: String,
    remote: Option<String>,
    base: String,
    head: String,
) -> AppResult<String> {
    let (_, remote) = context(&path, remote.as_deref())?;
    let url = remote.compare_url(&base, &head)?;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::General(format!("Cannot open GitHub compare URL: {e}")))?;
    Ok(url)
}

#[tauri::command]
pub fn github_open_repo(app: AppHandle, path: String, remote: Option<String>) -> AppResult<String> {
    let (_, remote) = context(&path, remote.as_deref())?;
    let url = remote.web_url();
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::General(format!("Cannot open repository URL: {e}")))?;
    Ok(url)
}

#[tauri::command]
pub async fn github_pr_list(path: String, remote: Option<String>) -> AppResult<Vec<PullRequest>> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        return tokio::task::spawn_blocking(move || github::gh_list(&workdir, &remote))
            .await
            .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?;
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return api.list().await;
    }
    Err(AppError::Credential("Authenticate GitHub CLI or store a GitHub PAT; compare/create-in-browser remains available without a token".into()))
}

#[tauri::command]
pub async fn github_pr_view(
    path: String,
    remote: Option<String>,
    number: u64,
) -> AppResult<PullRequestDetail> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        return tokio::task::spawn_blocking(move || github::gh_view(&workdir, &remote, number))
            .await
            .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?;
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return api.view(number).await;
    }
    Err(AppError::Credential(
        "GitHub authentication is required to view pull request details".into(),
    ))
}

#[tauri::command]
pub async fn github_pr_create(
    app: AppHandle,
    path: String,
    remote: Option<String>,
    input: CreatePullRequest,
) -> AppResult<WorkflowResult> {
    if input.title.trim().is_empty() {
        return Err(AppError::General(
            "Pull request title must not be empty".into(),
        ));
    }
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        let remote_copy = remote.clone();
        let input_copy = input.clone();
        let pr = tokio::task::spawn_blocking(move || {
            github::gh_create(&workdir, &remote_copy, &input_copy)
        })
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))??;
        return Ok(WorkflowResult {
            pull_request: Some(pr),
            opened_url: None,
            backend: "gh".into(),
        });
    }
    if let Some(api) = GitHubApi::from_store(remote.clone())? {
        let pr = api.create(&input).await?;
        return Ok(WorkflowResult {
            pull_request: Some(pr),
            opened_url: None,
            backend: "api".into(),
        });
    }
    let url = remote.compare_url(&input.base, &input.head)?;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::General(format!("Cannot open GitHub create URL: {e}")))?;
    Ok(WorkflowResult {
        pull_request: None,
        opened_url: Some(url),
        backend: "browser".into(),
    })
}

#[tauri::command]
pub async fn github_pr_checkout(
    path: String,
    remote: Option<String>,
    number: u64,
) -> AppResult<String> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if !status.installed || !status.authenticated {
        return Err(AppError::General(
            "Authenticated GitHub CLI is required for PR checkout".into(),
        ));
    }
    tokio::task::spawn_blocking(move || github::gh_checkout(&workdir, &remote, number))
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?
}

/// PR diff snapshot prepared for AI review: head SHA + unified diff text plus
/// the PR title/body used as review context.
#[derive(Debug, Clone)]
pub struct PrDiffPayload {
    pub head_sha: String,
    pub title: String,
    pub body: String,
    pub diff_text: String,
    pub file_count: usize,
    pub truncated: bool,
    pub backend: String,
}

/// Fetch a pull request's diff for AI review. Prefers the authenticated `gh`
/// CLI (also covers Enterprise hosts, where the stored PAT is never forwarded);
/// falls back to the stored PAT REST snapshot. The `gh` 1 MiB output cap and
/// `PR_DIFF_CHAR_CAP` both bound the result.
pub(crate) async fn fetch_pr_diff(
    path: &str,
    remote: Option<String>,
    number: u64,
) -> AppResult<PrDiffPayload> {
    let (repo, remote) = context(path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        let meta_workdir = workdir.clone();
        let meta_remote = remote.clone();
        let meta = tokio::task::spawn_blocking(move || {
            github::gh_pr_meta(&meta_workdir, &meta_remote, number)
        })
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))??;
        let diff_workdir = workdir.clone();
        let diff_remote = remote.clone();
        let raw = tokio::task::spawn_blocking(move || {
            github::gh_pr_diff(&diff_workdir, &diff_remote, number)
        })
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))??;
        let (diff_text, truncated) = github::cap_diff_text(raw);
        let file_count = diff_text.matches("diff --git ").count();
        return Ok(PrDiffPayload {
            head_sha: meta.head_sha,
            title: meta.title,
            body: meta.body,
            diff_text,
            file_count,
            truncated,
            backend: "gh".into(),
        });
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        let snapshot = api.pull_request_snapshot(number).await?;
        let file_count = snapshot.files.len();
        let (diff_text, truncated) = github::assemble_pr_diff_text(&snapshot.files);
        return Ok(PrDiffPayload {
            head_sha: snapshot.head_sha,
            title: snapshot.title,
            body: snapshot.body,
            diff_text,
            file_count,
            truncated,
            backend: "api".into(),
        });
    }
    Err(AppError::Credential(
        "Authenticate GitHub CLI or store a GitHub PAT to review a pull request".into(),
    ))
}

/// Best-effort current head SHA of a pull request (gh first, then PAT).
/// Returns `None` when it cannot be determined — the publish path re-validates
/// against a live snapshot, so staleness is a UI hint only.
pub(crate) async fn current_pr_head(
    path: &str,
    remote: Option<String>,
    number: u64,
) -> AppResult<Option<String>> {
    let (repo, remote) = context(path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        let meta_remote = remote.clone();
        let result =
            tokio::task::spawn_blocking(move || github::gh_pr_meta(&workdir, &meta_remote, number))
                .await
                .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")));
        if let Ok(Ok(meta)) = result {
            return Ok(Some(meta.head_sha));
        }
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return Ok(match api.view(number).await {
            Ok(detail) => detail.pull_request.head_sha,
            Err(_) => None,
        });
    }
    Ok(None)
}

#[tauri::command]
pub async fn github_publish_inline_comment(
    path: String,
    remote: Option<String>,
    input: InlineCommentRequest,
) -> AppResult<String> {
    if !input.confirmed {
        return Err(AppError::General(
            "Inline review comment requires explicit per-finding confirmation".into(),
        ));
    }
    let (repo, remote) = context(&path, remote.as_deref())?;
    let mut report = if input.pull_review {
        review::load_pr_report(&repo, input.pull_number)?.ok_or_else(|| {
            AppError::General("No saved review report for this pull request".into())
        })?
    } else {
        review::load_report(&repo)?
            .ok_or_else(|| AppError::General("No saved review report".into()))?
    };
    if report.id != input.report_id {
        return Err(AppError::General(
            "The selected review report is no longer current".into(),
        ));
    }
    if input.pull_review {
        if report.pull_number != Some(input.pull_number) {
            return Err(AppError::General(
                "The review report does not match this pull request".into(),
            ));
        }
        // PR-scoped staleness is enforced below by the publish-time snapshot
        // head check; the local-worktree recompute does not apply here.
    } else {
        review::recompute_stale(&repo, &mut report)?;
        if report.stale {
            return Err(AppError::General(
                "The review report is stale; run the review again".into(),
            ));
        }
    }
    let finding = report
        .findings
        .iter()
        .find(|finding| finding.id == input.finding_id)
        .ok_or_else(|| AppError::General("Review finding was not found".into()))?;
    let commit_id = report
        .head_hash
        .as_deref()
        .ok_or_else(|| AppError::General("The review has no commit snapshot".into()))?;
    let line = finding
        .line
        .ok_or_else(|| AppError::General("The review finding has no inline line".into()))?;
    let api = GitHubApi::from_store(remote)?.ok_or_else(|| {
        AppError::Credential(
            "A GitHub PAT in Credential Manager is required for inline review comments".into(),
        )
    })?;
    let snapshot = api.pull_request_snapshot(input.pull_number).await?;
    github::validate_inline_target(&snapshot, commit_id, &finding.file, line)?;
    let body = format!(
        "**{}**\n\n{}\n\n{}",
        finding.title, finding.description, finding.suggestion
    );
    api.inline_comment(input.pull_number, commit_id, &finding.file, line, &body)
        .await
}

#[tauri::command]
pub async fn github_issue_list(
    path: String,
    remote: Option<String>,
) -> AppResult<Vec<GitHubIssue>> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        return tokio::task::spawn_blocking(move || github::gh_issue_list(&workdir, &remote))
            .await
            .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?;
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return api.issue_list().await;
    }
    Err(AppError::Credential(
        "Authenticate GitHub CLI or store a GitHub PAT to browse issues".into(),
    ))
}

#[tauri::command]
pub async fn github_issue_create(
    path: String,
    remote: Option<String>,
    title: String,
    body: String,
) -> AppResult<String> {
    if title.trim().is_empty() {
        return Err(AppError::General("Issue title must not be empty".into()));
    }
    if title.len() > 1_000 || body.len() > 64 * 1024 {
        return Err(AppError::General("Issue title/body too long".into()));
    }
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    if status.installed && status.authenticated {
        return tokio::task::spawn_blocking(move || {
            github::gh_issue_create(&workdir, &remote, &title, &body)
        })
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?;
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return api.issue_create(&title, &body).await;
    }
    Err(AppError::Credential(
        "GitHub authentication is required to create an issue".into(),
    ))
}

/// Create a DRAFT GitHub release from the release notes editor. Publishing is
/// deliberately left to the user on GitHub; the aigit command always sends
/// `draft: true`. When the tag does not exist on the remote yet, GitHub
/// creates it from the repository's default branch.
#[tauri::command]
pub async fn github_release_create(
    path: String,
    remote: Option<String>,
    tag_name: String,
    name: String,
    body: String,
) -> AppResult<String> {
    if tag_name.trim().is_empty() {
        return Err(AppError::General("Release tag must not be empty".into()));
    }
    if name.trim().is_empty() {
        return Err(AppError::General("Release name must not be empty".into()));
    }
    if name.len() > 1_000 || body.len() > 64 * 1024 {
        return Err(AppError::General("Release name/body too long".into()));
    }
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = gh_status_on_blocking_pool(&workdir, &remote.host).await?;
    let input = github::CreateRelease {
        tag_name,
        name,
        body,
        draft: true,
        target_commitish: None,
    };
    if status.installed && status.authenticated {
        return tokio::task::spawn_blocking(move || {
            github::gh_release_create(&workdir, &remote, &input)
        })
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?;
    }
    if let Some(api) = GitHubApi::from_store(remote)? {
        return api.release_create(&input).await;
    }
    Err(AppError::Credential(
        "Authenticate GitHub CLI or store a GitHub PAT to draft a release".into(),
    ))
}

#[tauri::command]
pub fn set_github_pat(token: String) -> AppResult<()> {
    use crate::config::{CredentialStore, SystemCredentialStore};
    let token = token.trim();
    // Sanity checks only — GitHub token formats may evolve, so require a
    // plausible length without whitespace instead of pinning known prefixes.
    if token.len() < 20 || token.len() > 255 || token.chars().any(char::is_whitespace) {
        return Err(AppError::Credential(
            "GitHub PAT looks malformed: expected 20–255 characters without whitespace".into(),
        ));
    }
    SystemCredentialStore.set("github_pat", token)
}

#[tauri::command]
pub fn delete_github_pat() -> AppResult<()> {
    use crate::config::{CredentialStore, SystemCredentialStore};
    SystemCredentialStore.delete("github_pat")
}
