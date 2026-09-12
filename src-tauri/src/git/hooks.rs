use std::path::Path;

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Client-relevant git hooks in their canonical order. Names double as a
/// whitelist: no arbitrary file in the hooks directory can be read or
/// overwritten through the hook editor.
const KNOWN_HOOKS: &[&str] = &[
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
];

/// Size cap for hook scripts read or written through the editor.
const MAX_HOOK_BYTES: usize = 1024 * 1024;

/// One hook slot in the repository's hooks directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookInfo {
    pub name: String,
    /// Absolute path of the hook script; empty when the hook does not exist.
    pub path: String,
    /// `true` when a hook file exists for this name.
    pub exists: bool,
    /// `true` when the file has the executable bit (Unix only; always false
    /// on Windows where the bit does not exist).
    pub executable: bool,
}

fn hooks_dir(repo: &Repository) -> AppResult<std::path::PathBuf> {
    // core.hooksPath (relative paths resolve against the workdir, per git).
    let override_path = repo
        .config()
        .ok()
        .and_then(|config| config.get_string("core.hooksPath").ok());
    if let Some(custom) = override_path {
        let p = std::path::PathBuf::from(&custom);
        if p.is_absolute() {
            return Ok(p);
        }
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::General("裸仓库没有工作区".into()))?;
        return Ok(workdir.join(p));
    }
    Ok(repo.path().join("hooks"))
}

fn validate_name(name: &str) -> AppResult<()> {
    if !KNOWN_HOOKS.contains(&name) {
        return Err(AppError::General(format!("不是受支持的 hook 名称：{name}")));
    }
    Ok(())
}

pub fn list_hooks(repo: &Repository) -> AppResult<Vec<HookInfo>> {
    let dir = hooks_dir(repo)?;
    let mut hooks = Vec::new();
    for name in KNOWN_HOOKS {
        let path = dir.join(name);
        let meta = std::fs::metadata(&path);
        let exists = meta.as_ref().map(|m| m.is_file()).unwrap_or(false);
        let executable = meta
            .as_ref()
            .map(|m| executable_bit(&path, m.permissions()))
            .unwrap_or(false);
        hooks.push(HookInfo {
            name: (*name).to_string(),
            path: if exists {
                path.to_string_lossy().into_owned()
            } else {
                String::new()
            },
            exists,
            executable,
        });
    }
    Ok(hooks)
}

#[cfg(unix)]
fn executable_bit(_path: &Path, permissions: std::fs::Permissions) -> bool {
    use std::os::unix::fs::PermissionsExt;
    permissions.mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable_bit(_path: &Path, _permissions: std::fs::Permissions) -> bool {
    false
}

pub fn get_hook_content(repo: &Repository, name: &str) -> AppResult<String> {
    validate_name(name)?;
    let path = hooks_dir(repo)?.join(name);
    if !path.is_file() {
        return Ok(String::new());
    }
    let bytes =
        std::fs::read(&path).map_err(|e| AppError::General(format!("读取 hook 失败：{e}")))?;
    if bytes.len() > MAX_HOOK_BYTES {
        return Err(AppError::General("hook 文件过大，超出编辑上限".into()));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn save_hook_content(repo: &Repository, name: &str, content: &str) -> AppResult<()> {
    validate_name(name)?;
    if content.len() > MAX_HOOK_BYTES {
        return Err(AppError::General("hook 内容过大，超出写入上限".into()));
    }
    let dir = hooks_dir(repo)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::General(format!("创建 hooks 目录失败：{e}")))?;
    let path = dir.join(name);
    std::fs::write(&path, content)
        .map_err(|e| AppError::General(format!("写入 hook 失败：{e}")))?;
    make_executable(&path);
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o755);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) {}
