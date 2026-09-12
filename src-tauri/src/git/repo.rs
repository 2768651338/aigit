use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::RepoInfo;

pub fn open_repo(path: &str) -> AppResult<Repository> {
    Repository::open(path).map_err(|_| AppError::NotARepo(path.to_string()))
}

pub fn discover_repo(path: &str) -> AppResult<String> {
    Repository::discover(path)
        .map(|repo| {
            repo.workdir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        })
        .map_err(|_| AppError::NotARepo(path.to_string()))
}

pub fn init_repo(path: &str) -> AppResult<()> {
    Repository::init(Path::new(path))?;
    Ok(())
}

/// Clone via the git CLI instead of libgit2: the CLI uses the system
/// credential helper (so private-repo HTTPS clones work exactly like
/// push/pull do), honours a hard timeout, and can be cancelled mid-flight.
/// The parent of `target_path` is created if missing.
pub fn clone_repo(
    url: &str,
    target_path: &str,
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<()> {
    validate_clone_url(url)?;
    crate::git::cli::validate_arg(url, "clone url")?;
    crate::git::cli::validate_non_option(target_path, "clone target path")?;
    let target = Path::new(target_path);
    let parent = target
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| AppError::General("Invalid clone target path".into()))?;
    std::fs::create_dir_all(parent)?;
    let output = crate::git::cli::run_cancellable(
        parent,
        ["clone", "--progress", url, target_path],
        crate::git::cli::REMOTE_TIMEOUT,
        cancellation,
    )?;
    if !output.success() {
        return Err(crate::git::cli::command_failed("Clone failed", &output));
    }
    Ok(())
}

/// Restrict clone sources to remote transports. `https://` and `ssh://` are
/// accepted, plus scp-like `git@host:path` syntax; plain local paths and
/// `file://`/`http://`/`git://` are rejected (use "open" for local folders).
fn validate_clone_url(url: &str) -> AppResult<()> {
    if url.starts_with('-') {
        return Err(AppError::General(
            "Clone URL must not start with '-'".into(),
        ));
    }
    if let Some(scheme_end) = url.find("://") {
        let scheme = url[..scheme_end].to_ascii_lowercase();
        if scheme == "https" || scheme == "ssh" {
            return Ok(());
        }
        return Err(AppError::General(format!(
            "Unsupported clone URL scheme '{scheme}': only https and ssh are allowed"
        )));
    }
    // No "://": allow scp-like ssh syntax (user@host:path) only. The '@' must
    // precede the ':' so a plain Windows path like `D:\repo` is rejected.
    let colon = url.find(':');
    let at = url.find('@');
    if let (Some(colon), Some(at)) = (colon, at) {
        if at < colon {
            return Ok(());
        }
    }
    Err(AppError::General(
        "Clone URL must be https://, ssh:// or git@host:path".into(),
    ))
}

pub fn get_repo_info(repo: &Repository) -> AppResult<RepoInfo> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;
    let path = workdir.to_string_lossy().to_string();
    let name = workdir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let current_branch = get_current_branch_name(repo);

    let (ahead, behind) = match &current_branch {
        Some(branch) => get_ahead_behind(repo, branch).unwrap_or((0, 0)),
        None => (0, 0),
    };

    let head_hash = repo
        .head()
        .ok()
        .and_then(|h| h.target().map(|t| t.to_string()));

    Ok(RepoInfo {
        path,
        name,
        current_branch,
        ahead,
        behind,
        head_hash,
    })
}

pub fn get_current_branch_name(repo: &Repository) -> Option<String> {
    repo.head().ok().and_then(|head| {
        if head.is_branch() {
            head.shorthand().map(|s| s.to_string())
        } else {
            None
        }
    })
}

fn get_ahead_behind(repo: &Repository, branch_name: &str) -> AppResult<(usize, usize)> {
    let local_branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
    let local_commit = local_branch.get().peel_to_commit()?;

    let upstream = local_branch
        .upstream()
        .map_err(|_| AppError::General("No upstream".to_string()))?;
    let upstream_commit = upstream.get().peel_to_commit()?;

    let (ahead, behind) = repo.graph_ahead_behind(local_commit.id(), upstream_commit.id())?;

    Ok((ahead, behind))
}

#[cfg(test)]
mod tests {
    use super::{discover_repo, get_repo_info, init_repo, open_repo, validate_clone_url};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("aigit-repo-{name}-{unique}"))
    }

    #[test]
    fn clone_url_whitelist_accepts_remote_transports_only() {
        assert!(validate_clone_url("https://example.com/repo.git").is_ok());
        assert!(validate_clone_url("ssh://git@example.com/repo.git").is_ok());
        assert!(validate_clone_url("git@example.com:repo.git").is_ok());

        assert!(validate_clone_url("http://example.com/repo.git").is_err());
        assert!(validate_clone_url("file:///C:/work/repo").is_err());
        assert!(validate_clone_url("git://example.com/repo.git").is_err());
        // A plain Windows path is not a remote URL.
        assert!(validate_clone_url("D:\\work\\repo").is_err());
        assert!(validate_clone_url("-odd-start").is_err());
    }

    #[test]
    fn init_discover_and_repo_info_agree() {
        let root = unique_dir("info");
        fs::create_dir_all(&root).expect("create temp dir");

        init_repo(root.to_str().expect("utf8")).expect("init repo");
        assert!(root.join(".git").exists());

        fn normalize(p: &str) -> String {
            let mut value = p.replace('\\', "/");
            // 剥离 canonicalize 产生的 Windows 扩展长度路径前缀（\\?\）。
            if let Some(stripped) = value.strip_prefix("//?/") {
                value = stripped.to_string();
            }
            while value.ends_with('/') {
                value.pop();
            }
            value
        }

        // CI runner 的 TEMP 可能是 8.3 短名（如 RUNNER~1），libgit2 返回
        // 规范真实路径；两边都 canonicalize 后再比较。
        let canonical_root = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
        let expected = normalize(&canonical_root.to_string_lossy());
        // libgit2 可能以尾部分隔符或平台相关斜杠报告 workdir，统一后比较。
        let discovered = discover_repo(root.to_str().expect("utf8")).expect("discover");
        assert_eq!(
            normalize(&discovered),
            expected,
            "unexpected discovered path"
        );

        let repo = open_repo(root.to_str().expect("utf8")).expect("open");
        let info = get_repo_info(&repo).expect("repo info");
        assert_eq!(normalize(&info.path), expected);
        assert_eq!(
            info.name,
            root.file_name().expect("file name").to_string_lossy()
        );
        // Fresh repo: no commit yet, so no current branch.
        assert_eq!(info.current_branch, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn open_repo_rejects_non_repositories() {
        let root = unique_dir("not-repo");
        fs::create_dir_all(&root).expect("create temp dir");
        assert!(open_repo(root.to_str().expect("utf8")).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
