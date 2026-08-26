use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::git;

fn spawn_failed(e: std::io::Error) -> AppError {
    AppError::General(format!("Failed to launch terminal: {e}"))
}

/// Resolve and normalize the repository working directory. `open_repo`
/// guarantees this is a real git repository; `canonicalize` additionally
/// collapses symlinks/traversals into an absolute OS-verified path before it
/// may touch any child process.
fn validated_workdir(path: &str) -> AppResult<PathBuf> {
    let repo = git::repo::open_repo(path)?;
    let workdir = git::cli::workdir(&repo)?;
    let dir = std::fs::canonicalize(workdir)
        .map_err(|e| AppError::General(format!("Failed to resolve repository directory: {e}")))?;
    if !dir.is_dir() {
        return Err(AppError::General(
            "Repository path is not a directory".into(),
        ));
    }
    Ok(dir)
}

/// Open Windows Command Prompt rooted at the repository directory.
///
/// Program name and arguments are compile-time literals; the repository
/// directory is applied as the child's working directory — never passed
/// through a shell or interpolated into a command line — so paths containing
/// spaces or metacharacters cannot alter what gets executed.
#[cfg(target_os = "windows")]
fn spawn_terminal(dir: &Path) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    Command::new("cmd")
        .arg("/K")
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(spawn_failed)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn spawn_terminal(_dir: &Path) -> AppResult<()> {
    Err(AppError::General(
        "Opening a terminal is currently supported on Windows only".into(),
    ))
}

/// Open the operating system's terminal rooted at the repository working
/// directory. The path is validated as a real git repository first, so the
/// webview cannot use this command to spawn shells in arbitrary locations.
#[tauri::command]
pub fn open_repo_in_terminal(path: String) -> AppResult<()> {
    let dir = validated_workdir(&path)?;
    spawn_terminal(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_are_not_repositories() {
        let tmp = std::env::temp_dir().join(format!("aigit-not-repo-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).expect("create temp dir");
        assert!(validated_workdir(tmp.to_str().expect("utf8")).is_err());
        let _ = std::fs::remove_dir(&tmp);
    }
}
