use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use git2::{BranchType, Repository};

use crate::error::{AppError, AppResult};

use super::cli::{self, REMOTE_TIMEOUT};
use super::{RemoteInfo, TrackingInfo};

fn validate_remote_name(name: &str) -> AppResult<()> {
    cli::validate_non_option(name, "远程仓库名")?;
    let probe = format!("refs/remotes/{name}/aigit-validation");
    if !git2::Reference::is_valid_name(&probe) {
        return Err(AppError::General(format!("无效的远程仓库名：{name}")));
    }
    Ok(())
}

fn validate_branch_name(name: &str, label: &str) -> AppResult<()> {
    cli::validate_non_option(name, label)?;
    let reference = format!("refs/heads/{name}");
    if !git2::Reference::is_valid_name(&reference) {
        return Err(AppError::General(format!("无效的{label}：{name}")));
    }
    Ok(())
}

fn validate_remote_url(url: &str) -> AppResult<()> {
    cli::validate_non_option(url, "远程仓库 URL")
}

fn current_branch(repo: &Repository) -> AppResult<String> {
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(AppError::General(
            "当前处于 detached HEAD，无法确定上游分支".into(),
        ));
    }
    head.shorthand()
        .map(str::to_owned)
        .ok_or_else(|| AppError::General("无法读取当前分支名".into()))
}

pub fn list_remotes(repo: &Repository) -> AppResult<Vec<RemoteInfo>> {
    let mut result = Vec::new();
    for name in repo.remotes()?.iter().flatten() {
        let remote = repo.find_remote(name)?;
        result.push(RemoteInfo {
            name: name.to_string(),
            fetch_url: remote.url().unwrap_or_default().to_string(),
            push_url: remote
                .pushurl()
                .unwrap_or(remote.url().unwrap_or_default())
                .to_string(),
        });
    }
    result.sort_by_key(|remote| remote.name.to_lowercase());
    Ok(result)
}

pub fn add_remote(repo: &Repository, name: &str, url: &str) -> AppResult<()> {
    validate_remote_name(name)?;
    validate_remote_url(url)?;
    repo.remote(name, url)?;
    Ok(())
}

pub fn edit_remote(repo: &Repository, old_name: &str, new_name: &str, url: &str) -> AppResult<()> {
    validate_remote_name(old_name)?;
    validate_remote_name(new_name)?;
    validate_remote_url(url)?;
    if old_name != new_name {
        rename_remote(repo, old_name, new_name)?;
    }
    set_remote_url(repo, new_name, url, false)
}

pub fn remove_remote(repo: &Repository, name: &str) -> AppResult<()> {
    validate_remote_name(name)?;
    repo.remote_delete(name)?;
    Ok(())
}

pub fn rename_remote(repo: &Repository, old_name: &str, new_name: &str) -> AppResult<()> {
    validate_remote_name(old_name)?;
    validate_remote_name(new_name)?;
    let problems = repo.remote_rename(old_name, new_name)?;
    if !problems.is_empty() {
        return Err(AppError::General(format!(
            "远程仓库已重命名，但以下 refspec 无法更新：{}",
            problems.iter().flatten().collect::<Vec<_>>().join(", ")
        )));
    }
    Ok(())
}

pub fn set_remote_url(repo: &Repository, name: &str, url: &str, push: bool) -> AppResult<()> {
    validate_remote_name(name)?;
    validate_remote_url(url)?;
    repo.find_remote(name)?;
    if push {
        repo.remote_set_pushurl(name, Some(url))?;
    } else {
        repo.remote_set_url(name, url)?;
    }
    Ok(())
}

pub fn tracking_info(repo: &Repository) -> AppResult<TrackingInfo> {
    let branch_name = current_branch(repo)?;
    let branch = repo.find_branch(&branch_name, BranchType::Local)?;
    let Ok(upstream) = branch.upstream() else {
        return Ok(TrackingInfo {
            branch: branch_name,
            upstream: None,
            remote: None,
            remote_branch: None,
            ahead: 0,
            behind: 0,
        });
    };

    let upstream_name = upstream.name()?.unwrap_or_default().to_string();
    let (remote, remote_branch) = upstream_name
        .split_once('/')
        .map(|(remote, branch)| (Some(remote.to_string()), Some(branch.to_string())))
        .unwrap_or((None, None));
    let local_oid = branch.get().peel_to_commit()?.id();
    let upstream_oid = upstream.get().peel_to_commit()?.id();
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;

    Ok(TrackingInfo {
        branch: branch_name,
        upstream: Some(upstream_name),
        remote,
        remote_branch,
        ahead,
        behind,
    })
}

pub fn set_upstream(
    repo: &Repository,
    remote: &str,
    remote_branch: &str,
) -> AppResult<TrackingInfo> {
    validate_remote_name(remote)?;
    validate_branch_name(remote_branch, "远程分支名")?;
    repo.find_remote(remote)?;
    let branch_name = current_branch(repo)?;
    let mut branch = repo.find_branch(&branch_name, BranchType::Local)?;
    let upstream = format!("{remote}/{remote_branch}");
    branch.set_upstream(Some(&upstream))?;
    tracking_info(repo)
}

pub fn fetch(
    repo: &Repository,
    remote: Option<&str>,
    prune: bool,
    tags: bool,
) -> AppResult<String> {
    fetch_cancellable(repo, remote, prune, tags, None)
}

pub fn fetch_cancellable(
    repo: &Repository,
    remote: Option<&str>,
    prune: bool,
    tags: bool,
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<String> {
    let workdir = cli::workdir(repo)?;
    let mut args = vec!["fetch".to_string()];
    if prune {
        args.push("--prune".into());
    }
    args.push(if tags { "--tags" } else { "--no-tags" }.into());
    if let Some(remote) = remote {
        validate_remote_name(remote)?;
        repo.find_remote(remote)?;
        args.push("--".into());
        args.push(remote.to_string());
    } else {
        args.push("--all".into());
    }
    match cancellation {
        Some(flag) => {
            cli::run_checked_cancellable(workdir, args, REMOTE_TIMEOUT, "获取远程更新失败", flag)
        }
        None => cli::run_checked(workdir, args, REMOTE_TIMEOUT, "获取远程更新失败"),
    }
}

pub fn push_current_branch(
    repo: &Repository,
    explicit_remote: Option<&str>,
    explicit_remote_branch: Option<&str>,
) -> AppResult<String> {
    push_current_branch_cancellable(repo, explicit_remote, explicit_remote_branch, None)
}

pub fn push_current_branch_cancellable(
    repo: &Repository,
    explicit_remote: Option<&str>,
    explicit_remote_branch: Option<&str>,
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<String> {
    let branch = current_branch(repo)?;
    let tracking = tracking_info(repo)?;
    let target = match (tracking.remote, tracking.remote_branch) {
        (Some(remote), Some(remote_branch)) => (remote, remote_branch, false),
        _ => {
            let remote = explicit_remote.ok_or_else(|| {
                AppError::General(
                    "当前分支没有 upstream，请选择远程仓库和远程分支以显式设置".into(),
                )
            })?;
            let remote_branch = explicit_remote_branch.ok_or_else(|| {
                AppError::General("当前分支没有 upstream，请显式指定远程分支".into())
            })?;
            (remote.to_string(), remote_branch.to_string(), true)
        }
    };
    validate_remote_name(&target.0)?;
    validate_branch_name(&target.1, "远程分支名")?;
    repo.find_remote(&target.0)?;

    let mut args = vec!["push".to_string()];
    if target.2 {
        args.push("--set-upstream".into());
    }
    args.push("--".into());
    args.push(target.0.clone());
    args.push(format!("refs/heads/{branch}:refs/heads/{}", target.1));
    let error = format!("推送分支 {branch} 失败");
    match cancellation {
        Some(flag) => {
            cli::run_checked_cancellable(cli::workdir(repo)?, args, REMOTE_TIMEOUT, &error, flag)
        }
        None => cli::run_checked(cli::workdir(repo)?, args, REMOTE_TIMEOUT, &error),
    }
}

pub fn pull_current_branch(repo: &Repository) -> AppResult<String> {
    pull_current_branch_cancellable(repo, None)
}

pub fn pull_current_branch_cancellable(
    repo: &Repository,
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<String> {
    let tracking = tracking_info(repo)?;
    let remote = tracking.remote.ok_or_else(|| {
        AppError::General("当前分支没有 upstream，请先显式设置上游分支再拉取".into())
    })?;
    let remote_branch = tracking
        .remote_branch
        .ok_or_else(|| AppError::General("当前分支的 upstream 配置无效，请重新设置".into()))?;
    validate_remote_name(&remote)?;
    validate_branch_name(&remote_branch, "远程分支名")?;
    let error = format!("从 {remote}/{remote_branch} 拉取失败");
    let args = ["pull", "--", remote.as_str(), remote_branch.as_str()];
    match cancellation {
        Some(flag) => {
            cli::run_checked_cancellable(cli::workdir(repo)?, args, REMOTE_TIMEOUT, &error, flag)
        }
        None => cli::run_checked(cli::workdir(repo)?, args, REMOTE_TIMEOUT, &error),
    }
}

pub fn create_tracking_branch(
    repo: &Repository,
    remote_branch: &str,
    local_name: Option<&str>,
) -> AppResult<String> {
    cli::validate_non_option(remote_branch, "远程分支")?;
    let (remote, branch_name) = remote_branch
        .split_once('/')
        .ok_or_else(|| AppError::General("远程分支必须使用 <remote>/<branch> 格式".into()))?;
    validate_remote_name(remote)?;
    validate_branch_name(branch_name, "远程分支名")?;
    let local = local_name.unwrap_or(branch_name);
    validate_branch_name(local, "本地分支名")?;
    repo.find_branch(remote_branch, BranchType::Remote)?;

    cli::run_checked(
        cli::workdir(repo)?,
        ["switch", "--track", "-c", local, remote_branch],
        cli::LOCAL_TIMEOUT,
        &format!("创建跟踪分支 {local} 失败"),
    )?;
    Ok(local.to_string())
}

pub fn push_tag(repo: &Repository, remote: &str, tag: &str) -> AppResult<String> {
    validate_remote_name(remote)?;
    validate_branch_name(tag, "标签名")?;
    repo.find_remote(remote)?;
    repo.find_reference(&format!("refs/tags/{tag}"))?;
    let refspec = format!("refs/tags/{tag}:refs/tags/{tag}");
    cli::run_checked(
        cli::workdir(repo)?,
        ["push", "--", remote, refspec.as_str()],
        REMOTE_TIMEOUT,
        &format!("推送标签 {tag} 失败"),
    )
}

pub fn delete_remote_tag(repo: &Repository, remote: &str, tag: &str) -> AppResult<String> {
    validate_remote_name(remote)?;
    validate_branch_name(tag, "标签名")?;
    repo.find_remote(remote)?;
    let refspec = format!(":refs/tags/{tag}");
    cli::run_checked(
        cli::workdir(repo)?,
        ["push", "--", remote, refspec.as_str()],
        REMOTE_TIMEOUT,
        &format!("删除远程标签 {tag} 失败"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("aigit-remote-{name}-{unique}"))
    }

    fn git(path: &Path, args: &[&str]) {
        cli::run_checked(
            path,
            args.iter().copied(),
            cli::LOCAL_TIMEOUT,
            "test git failed",
        )
        .unwrap();
    }

    #[test]
    fn remote_fetch_upstream_and_tags_work_with_temp_repositories() {
        let root = temp_dir("integration");
        let bare = root.join("remote.git");
        let work = root.join("work");
        fs::create_dir_all(&bare).unwrap();
        fs::create_dir_all(&work).unwrap();
        git(&bare, &["init", "--bare"]);
        git(&work, &["init"]);
        git(&work, &["config", "user.name", "Test"]);
        git(&work, &["config", "user.email", "test@example.com"]);
        fs::write(work.join("README.txt"), "test").unwrap();
        git(&work, &["add", "README.txt"]);
        git(&work, &["commit", "-m", "initial"]);

        let repo = Repository::open(&work).unwrap();
        let remote_url = bare.to_string_lossy().replace('\\', "/");
        add_remote(&repo, "origin", &remote_url).unwrap();
        assert_eq!(list_remotes(&repo).unwrap().len(), 1);
        let branch = current_branch(&repo).unwrap();
        push_current_branch(&repo, Some("origin"), Some(&branch)).unwrap();
        assert_eq!(
            tracking_info(&repo).unwrap().upstream.as_deref(),
            Some(format!("origin/{branch}").as_str())
        );
        fetch(&repo, Some("origin"), true, true).unwrap();

        let clone = root.join("clone");
        git(
            &root,
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                clone.to_string_lossy().as_ref(),
            ],
        );
        git(&clone, &["config", "user.name", "Clone"]);
        git(&clone, &["config", "user.email", "clone@example.com"]);
        fs::write(clone.join("remote.txt"), "remote change").unwrap();
        git(&clone, &["add", "remote.txt"]);
        git(&clone, &["commit", "-m", "remote change"]);
        git(&clone, &["push", "origin", &branch]);
        fetch(&repo, Some("origin"), true, true).unwrap();
        let tracking = tracking_info(&repo).unwrap();
        assert_eq!((tracking.ahead, tracking.behind), (0, 1));
        pull_current_branch(&repo).unwrap();
        assert!(work.join("remote.txt").exists());

        super::super::tag::create_tag(&repo, "v1.0.0", None).unwrap();
        push_tag(&repo, "origin", "v1.0.0").unwrap();
        delete_remote_tag(&repo, "origin", "v1.0.0").unwrap();

        rename_remote(&repo, "origin", "upstream").unwrap();
        set_remote_url(&repo, "upstream", &remote_url, true).unwrap();
        edit_remote(&repo, "upstream", "mirror", &remote_url).unwrap();
        remove_remote(&repo, "mirror").unwrap();
        assert!(list_remotes(&repo).unwrap().is_empty());
        drop(repo);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_option_like_remote_arguments() {
        assert!(validate_remote_name("--upload-pack=evil").is_err());
        assert!(validate_remote_url("--exec=evil").is_err());
        assert!(validate_branch_name("-bad", "分支名").is_err());
    }
}
