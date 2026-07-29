use git2::{IndexAddOption, Repository, Signature};

use crate::error::{AppError, AppResult};

pub fn stage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let mut index = repo.index()?;
    if paths.is_empty() {
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    } else {
        for path in paths {
            index.add_path(std::path::Path::new(path))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn stage_all(repo: &Repository) -> AppResult<()> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let head = repo.head()?;
    let head_commit = head.peel_to_commit()?;
    let head_obj = repo.find_object(head_commit.id(), None)?;

    if paths.is_empty() {
        repo.reset_default(Some(&head_obj), &["*"])?;
    } else {
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        repo.reset_default(Some(&head_obj), &path_refs)?;
    }

    Ok(())
}

pub fn commit(repo: &Repository, message: &str) -> AppResult<String> {
    let sig = repo.signature().or_else(|_| {
        Signature::now("aigit", "aigit@local").map_err(|e| AppError::Git(e))
    })?;

    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let head = repo.head()?;
    let parent_commit = head.peel_to_commit()?;

    let commit_oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        &[&parent_commit],
    )?;

    Ok(commit_oid.to_string())
}

pub fn amend_message(repo: &Repository, message: &str) -> AppResult<String> {
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    let sig = repo.signature()?;

    let oid = commit.amend(
        Some("HEAD"),
        Some(&sig),
        Some(&sig),
        None,
        Some(message),
        None,
    )?;

    Ok(oid.to_string())
}

/// Discard uncommitted changes in the given working-tree files using the
/// system `git checkout -- <paths>`. We use the CLI (not libgit2) because
/// libgit2's checkout API is fiddly to configure correctly for path-limited
/// discards on Windows, and we already depend on the system git for push/pull.
///
/// - Empty `paths` discards ALL working-tree modifications (unstaged + untracked
///   files are NOT removed; only tracked modifications are reverted). Pass
///   specific paths to limit scope.
/// - This is a DESTRUCTIVE operation; callers should confirm with the user.
pub fn discard_files(repo: &Repository, paths: &[String]) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let mut args = vec!["checkout".to_string(), "--".to_string()];
    if paths.is_empty() {
        args.push(".".to_string());
    } else {
        for p in paths {
            args.push(p.clone());
        }
    }

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            AppError::General(format!(
                "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(AppError::General(format!("丢弃修改失败：\n{msg}")));
    }

    Ok(())
}

/// Apply a unified-diff patch to the index (a.k.a. `git apply --cached`).
///
/// Used by the "stage selected lines" feature in the diff viewer: the
/// frontend constructs a patch for the user's selected hunk subset and we
/// apply it directly to the index without touching the working tree.
///
/// `patch` is a UTF-8 unified diff. We write it to a temp file because
/// `git apply` reads from stdin only via `-` (Windows pipes are flaky).
pub fn apply_patch_to_index(repo: &Repository, patch: &str) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    // Write patch to a temp file inside the workdir (avoids path-permission
    // issues and ensures relative pathspec resolution matches git's CWD).
    let tmp = workdir.join(".aigit_patch.tmp");
    std::fs::write(&tmp, patch).map_err(|e| {
        AppError::General(format!("写入 patch 临时文件失败：{e}"))
    })?;

    let args = [
        "apply".to_string(),
        "--cached".to_string(),
        "--whitespace=nowarn".to_string(),
        ".aigit_patch.tmp".to_string(),
    ];

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output();

    // Always clean up the temp file.
    let _ = std::fs::remove_file(&tmp);

    let output = output.map_err(|e| {
        AppError::General(format!(
            "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
        ))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(AppError::General(format!("应用 patch 到暂存区失败：\n{msg}")));
    }

    Ok(())
}

/// Reverse-apply a unified-diff patch to the index (a.k.a. `git apply --cached -R`).
///
/// Used by the "unstage selected lines" feature: the frontend constructs a
/// patch for the user's selected hunk subset of the staged diff and we
/// reverse-apply it to the index.
pub fn apply_patch_to_index_reverse(repo: &Repository, patch: &str) -> AppResult<()> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))?;

    let tmp = workdir.join(".aigit_patch.tmp");
    std::fs::write(&tmp, patch).map_err(|e| {
        AppError::General(format!("写入 patch 临时文件失败：{e}"))
    })?;

    let args = [
        "apply".to_string(),
        "--cached".to_string(),
        "--reverse".to_string(),
        "--whitespace=nowarn".to_string(),
        ".aigit_patch.tmp".to_string(),
    ];

    let output = std::process::Command::new("git")
        .args(&args)
        .current_dir(workdir)
        .output();

    let _ = std::fs::remove_file(&tmp);

    let output = output.map_err(|e| {
        AppError::General(format!(
            "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{e}"
        ))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(AppError::General(format!("从暂存区反向应用 patch 失败：\n{msg}")));
    }

    Ok(())
}
