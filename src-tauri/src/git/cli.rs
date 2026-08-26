use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use git2::Repository;

use crate::error::{AppError, AppResult};

pub const LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
pub const REMOTE_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_STREAM_BYTES: usize = 1024 * 1024;
const MAX_DISPLAY_BYTES: usize = 16 * 1024;
const MAX_PATHSPEC_BYTES: usize = 4096;
// 子进程退出后等待管道收尾的上限：git 派生的辅助进程（凭据管理器、传输
// helper 等）若在 git 退出后仍持有继承的管道写端，EOF 永远不会到来，
// 无限等待会让调用方（如前端推送按钮）永久悬挂。
const STREAM_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const READER_CHUNK_BYTES: usize = 64 * 1024;

// GUI 子系统进程派生控制台程序时，Windows 会为其分配新的控制台窗口；
// CREATE_NO_WINDOW 抑制该窗口，避免 git 操作时反复弹出黑色命令框。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug)]
pub struct GitOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl GitOutput {
    pub fn success(&self) -> bool {
        self.status.success()
    }

    pub fn status_code(&self) -> Option<i32> {
        self.status.code()
    }

    pub fn stdout_lossy(&self) -> String {
        bounded_display(&self.stdout)
    }

    pub fn stderr_lossy(&self) -> String {
        bounded_display(&self.stderr)
    }

    pub fn combined_lossy(&self) -> String {
        combine_output(&self.stdout_lossy(), &self.stderr_lossy())
    }

    pub fn preferred_error_lossy(&self) -> String {
        let stderr = self.stderr_lossy();
        if stderr.trim().is_empty() {
            self.stdout_lossy()
        } else {
            stderr
        }
    }
}

pub fn workdir(repo: &Repository) -> AppResult<&Path> {
    repo.workdir()
        .ok_or_else(|| AppError::General("Bare repository has no workdir".to_string()))
}

pub fn run<I, S>(workdir: &Path, args: I, timeout: Duration) -> AppResult<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    run_cancellable(workdir, args, timeout, None)
}

pub fn run_cancellable<I, S>(
    workdir: &Path,
    args: I,
    timeout: Duration,
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let args: Vec<OsString> = args.into_iter().map(Into::into).collect();

    let mut command = Command::new("git");
    command
        .args(&args)
        .current_dir(workdir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        AppError::General(format!(
            "无法调用 git 命令，请确认系统已安装 Git 并加入 PATH。错误：{error}"
        ))
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::General("无法捕获 git 标准输出".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::General("无法捕获 git 标准错误".to_string()))?;
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();
    spawn_pipe_reader(stdout, stdout_tx);
    spawn_pipe_reader(stderr, stderr_tx);

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None)
                if cancellation
                    .as_ref()
                    .is_some_and(|flag| flag.load(Ordering::Relaxed)) =>
            {
                let _ = child.kill();
                let _ = child.wait();
                drain_stream(stdout_rx, MAX_STREAM_BYTES);
                drain_stream(stderr_rx, MAX_STREAM_BYTES);
                return Err(AppError::General("Git 操作已取消".to_string()));
            }
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let stdout = drain_stream(stdout_rx, MAX_STREAM_BYTES);
                let stderr = drain_stream(stderr_rx, MAX_STREAM_BYTES);
                let detail = combine_output(
                    &bounded_display(&stdout),
                    &bounded_display(&stderr),
                );
                let suffix = if detail.is_empty() {
                    String::new()
                } else {
                    format!("\n{detail}")
                };
                return Err(AppError::General(format!(
                    "git 命令超时（{} 秒）{suffix}",
                    timeout.as_secs()
                )));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                drain_stream(stdout_rx, MAX_STREAM_BYTES);
                drain_stream(stderr_rx, MAX_STREAM_BYTES);
                return Err(AppError::General(format!("等待 git 命令失败：{error}")));
            }
        }
    };

    // 进程已退出：限时收尾。若仍有辅助进程攥着继承的管道写端，超时后带
    // 已收到的输出直接返回，绝不因等不到 EOF 而悬挂调用方。
    let stdout = drain_stream(stdout_rx, MAX_STREAM_BYTES);
    let stderr = drain_stream(stderr_rx, MAX_STREAM_BYTES);

    Ok(GitOutput { status, stdout, stderr })
}

pub fn run_checked<I, S>(
    workdir: &Path,
    args: I,
    timeout: Duration,
    error_prefix: &str,
) -> AppResult<String>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let output = run(workdir, args, timeout)?;
    if !output.success() {
        return Err(command_failed(error_prefix, &output));
    }
    Ok(output.combined_lossy())
}

pub fn run_checked_cancellable<I, S>(
    workdir: &Path,
    args: I,
    timeout: Duration,
    error_prefix: &str,
    cancellation: Arc<AtomicBool>,
) -> AppResult<String>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let output = run_cancellable(workdir, args, timeout, Some(cancellation))?;
    if !output.success() {
        return Err(command_failed(error_prefix, &output));
    }
    Ok(output.combined_lossy())
}

pub fn command_failed(prefix: &str, output: &GitOutput) -> AppError {
    let code = output
        .status_code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "被信号终止".to_string());
    let detail = output.preferred_error_lossy();
    if detail.trim().is_empty() {
        AppError::General(format!("{prefix}（git 状态码：{code}）"))
    } else {
        AppError::General(format!(
            "{prefix}（git 状态码：{code}）：\n{}",
            detail.trim()
        ))
    }
}

pub fn validate_arg(value: &str, name: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::General(format!("{name}不能为空")));
    }
    if value.contains('\0') {
        return Err(AppError::General(format!("{name}不能包含 NUL 字符")));
    }
    Ok(())
}

pub fn validate_non_option(value: &str, name: &str) -> AppResult<()> {
    validate_arg(value, name)?;
    if value.starts_with('-') {
        return Err(AppError::General(format!("{name}不能以 '-' 开头")));
    }
    Ok(())
}

pub fn validate_pathspec(value: &str, name: &str) -> AppResult<()> {
    validate_arg(value, name)?;
    if value.len() > MAX_PATHSPEC_BYTES {
        return Err(AppError::General(format!("{name}过长")));
    }
    if value.starts_with(":(")
        || value.starts_with(":!")
        || value.starts_with(":^")
        || value.starts_with(":/")
    {
        return Err(AppError::General(format!(
            "{name}不能使用 Git pathspec magic"
        )));
    }
    Ok(())
}

fn sanitize_output(value: &str) -> String {
    let url_credentials = regex::Regex::new(r"(?i)(https?://)[^\s/@:]+(?::[^\s/@]*)?@")
        .expect("credential URL regex");
    let sensitive = regex::Regex::new(
        r"(?i)\b(authorization|token|password|passwd|api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)",
    )
    .expect("sensitive field regex");
    let value = url_credentials.replace_all(value, "$1[REDACTED]@");
    sensitive.replace_all(&value, "$1=[REDACTED]").into_owned()
}

fn bounded_display(bytes: &[u8]) -> String {
    let decoded = String::from_utf8_lossy(bytes);
    let safe = sanitize_output(&decoded);
    if safe.len() <= MAX_DISPLAY_BYTES {
        safe
    } else {
        let mut end = MAX_DISPLAY_BYTES;
        while !safe.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n[output truncated]", &safe[..end])
    }
}

/// Incrementally forward a pipe into a channel so the collector can bound its
/// wait. The thread blocks in `read` until EOF; if a lingering helper process
/// keeps the write end open, the thread stays parked until every holder exits
/// (or the app exits) while `drain_stream` has already moved on.
pub(crate) fn spawn_pipe_reader(
    mut reader: impl Read + Send + 'static,
    tx: mpsc::Sender<Vec<u8>>,
) {
    thread::spawn(move || {
        let mut buf = vec![0u8; READER_CHUNK_BYTES];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

/// Collect piped output, giving up after `STREAM_DRAIN_TIMEOUT` once the
/// producer stalls. Never blocks indefinitely on EOF.
pub(crate) fn drain_stream(rx: Receiver<Vec<u8>>, cap: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let deadline = Instant::now() + STREAM_DRAIN_TIMEOUT;
    loop {
        let now = Instant::now();
        if now >= deadline || out.len() >= cap {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok(chunk) => {
                let room = cap - out.len();
                out.extend(chunk.into_iter().take(room));
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    out
}

fn combine_output(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("aigit-git-cli-{name}-{unique}"))
    }

    #[test]
    fn validates_required_arguments() {
        assert!(validate_arg("main", "分支").is_ok());
        assert!(validate_arg("  ", "分支").is_err());
        assert!(validate_arg("bad\0value", "分支").is_err());
    }

    #[test]
    fn rejects_option_like_values() {
        assert!(validate_non_option("feature/test", "分支").is_ok());
        assert!(validate_non_option("--upload-pack=evil", "分支").is_err());
    }

    #[test]
    fn runs_git_with_literal_option_like_path_after_separator() {
        let root = temp_dir("literal-path");
        fs::create_dir_all(&root).expect("create temp repository");
        run_checked(&root, ["init"], LOCAL_TIMEOUT, "初始化临时仓库失败").expect("git init");
        fs::write(root.join("--literal-file"), "content").expect("write literal file");

        run_checked(
            &root,
            ["add", "--", "--literal-file"],
            LOCAL_TIMEOUT,
            "添加文件失败",
        )
        .expect("git add literal path");
        let output = run_checked(
            &root,
            ["diff", "--cached", "--name-only", "--"],
            LOCAL_TIMEOUT,
            "读取索引失败",
        )
        .expect("git diff");

        assert_eq!(output.trim(), "--literal-file");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn combines_output_without_extra_blank_lines() {
        assert_eq!(combine_output("ok\n", ""), "ok");
        assert_eq!(combine_output("", "progress\n"), "progress");
        assert_eq!(combine_output("ok\n", "progress\n"), "ok\nprogress");
    }

    #[test]
    fn drains_all_chunks_then_stops_on_disconnect() {
        let (tx, rx) = mpsc::channel();
        tx.send(b"hello ".to_vec()).unwrap();
        tx.send(b"world".to_vec()).unwrap();
        drop(tx);
        assert_eq!(drain_stream(rx, 1024), b"hello world");
    }

    #[test]
    fn drain_respects_capacity() {
        let (tx, rx) = mpsc::channel();
        tx.send(vec![7u8; 32]).unwrap();
        assert_eq!(drain_stream(rx, 8).len(), 8);
    }

    #[test]
    fn drain_returns_partial_after_timeout_without_sender_eof() {
        let (tx, rx) = mpsc::channel();
        tx.send(b"partial".to_vec()).unwrap();
        // 发送端不关闭（模拟辅助进程长期持有管道写端）：应在超时后返回已有数据。
        let out = drain_stream(rx, 1024);
        assert_eq!(out, b"partial");
        drop(tx);
    }

    #[test]
    fn pipe_reader_forwards_written_bytes() {
        use std::io::Cursor;
        let (tx, rx) = mpsc::channel();
        spawn_pipe_reader(Cursor::new(b"abc".to_vec()), tx);
        assert_eq!(drain_stream(rx, 1024), b"abc");
    }
}
