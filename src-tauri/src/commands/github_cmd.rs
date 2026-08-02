use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::git;
use crate::github::{
    self, CreatePullRequest, GhStatus, GitHubApi, GitHubRemote, InlineCommentRequest, PullRequest,
    PullRequestDetail, WorkflowResult,
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

#[tauri::command]
pub fn github_remote(path: String, remote: Option<String>) -> AppResult<GitHubRemote> {
    let (_, remote) = context(&path, remote.as_deref())?;
    Ok(remote)
}

#[tauri::command]
pub fn github_gh_status(path: String, remote: Option<String>) -> AppResult<GhStatus> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    Ok(github::gh_status(git::cli::workdir(&repo)?, &remote.host))
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
pub async fn github_pr_list(path: String, remote: Option<String>) -> AppResult<Vec<PullRequest>> {
    let (repo, remote) = context(&path, remote.as_deref())?;
    let workdir = git::cli::workdir(&repo)?.to_path_buf();
    let status = github::gh_status(&workdir, &remote.host);
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
    let status = github::gh_status(&workdir, &remote.host);
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
    let status = github::gh_status(&workdir, &remote.host);
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
    let status = github::gh_status(&workdir, &remote.host);
    if !status.installed || !status.authenticated {
        return Err(AppError::General(
            "Authenticated GitHub CLI is required for PR checkout".into(),
        ));
    }
    tokio::task::spawn_blocking(move || github::gh_checkout(&workdir, &remote, number))
        .await
        .map_err(|e| AppError::General(format!("GitHub CLI task failed: {e}")))?
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
    let mut report = review::load_report(&repo)?
        .ok_or_else(|| AppError::General("No saved review report".into()))?;
    if report.id != input.report_id {
        return Err(AppError::General(
            "The selected review report is no longer current".into(),
        ));
    }
    review::recompute_stale(&repo, &mut report)?;
    if report.stale {
        return Err(AppError::General(
            "The review report is stale; run the review again".into(),
        ));
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
pub fn set_github_pat(token: String) -> AppResult<()> {
    use crate::config::{CredentialStore, SystemCredentialStore};
    SystemCredentialStore.set("github_pat", &token)
}

#[tauri::command]
pub fn delete_github_pat() -> AppResult<()> {
    use crate::config::{CredentialStore, SystemCredentialStore};
    SystemCredentialStore.delete("github_pat")
}
