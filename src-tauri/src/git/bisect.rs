use serde::{Deserialize, Serialize};

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::cli::{self, LOCAL_TIMEOUT};

/// State of an in-progress `git bisect` session, used by the bisect wizard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BisectState {
    /// `true` while a bisect session is running.
    pub in_progress: bool,
    /// Commit currently checked out for testing (empty when not bisecting).
    pub current_commit: String,
    #[serde(default)]
    pub first_bad_commit: Option<String>,
    /// Raw `git bisect log` output (empty when not bisecting).
    pub log: String,
}

fn run_bisect(repo: &Repository, args: &[&str]) -> AppResult<String> {
    let workdir = cli::workdir(repo)?;
    let mut argv: Vec<std::ffi::OsString> = vec!["bisect".into()];
    argv.extend(args.iter().map(Into::into));
    let output = cli::run(workdir, argv, LOCAL_TIMEOUT)?;
    if !output.success() {
        return Err(cli::command_failed("git bisect 执行失败", &output));
    }
    Ok(output.combined_lossy())
}

/// Detect an in-progress bisect session: git marks it with a `BISECT_LOG`
/// file inside the git directory.
fn bisect_in_progress(repo: &Repository) -> bool {
    repo.path().join("BISECT_LOG").is_file()
}

pub fn get_state(repo: &Repository) -> AppResult<BisectState> {
    if !bisect_in_progress(repo) {
        return Ok(BisectState {
            in_progress: false,
            current_commit: String::new(),
            first_bad_commit: None,
            log: String::new(),
        });
    }
    let log = run_bisect(repo, &["log"])?;
    let head_args: Vec<std::ffi::OsString> = vec!["rev-parse".into(), "HEAD".into()];
    let head = cli::run(cli::workdir(repo)?, head_args, LOCAL_TIMEOUT)?;
    let first_bad_commit = find_first_bad_commit(repo)?;
    Ok(BisectState {
        in_progress: true,
        current_commit: head.combined_lossy().trim().to_string(),
        first_bad_commit,
        log,
    })
}

fn find_first_bad_commit(repo: &Repository) -> AppResult<Option<String>> {
    let bad = match repo.find_reference("refs/bisect/bad") {
        Ok(reference) => reference.peel_to_commit()?.id(),
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut walk = repo.revwalk()?;
    walk.push(bad)?;
    let mut has_good = false;
    for reference in repo.references_glob("refs/bisect/good-*")? {
        walk.hide(reference?.peel_to_commit()?.id())?;
        has_good = true;
    }
    if !has_good {
        return Ok(None);
    }
    let mut candidates = walk.take(2).collect::<Result<Vec<_>, _>>()?;
    Ok(if candidates.len() == 1 && candidates[0] == bad {
        Some(candidates.remove(0).to_string())
    } else {
        None
    })
}

/// Start a bisect session. `bad`/`good` may seed the initial marks; both are
/// optional and accept anything `git bisect start` accepts (hash, ref).
pub fn start(repo: &Repository, bad: Option<&str>, good: Option<&str>) -> AppResult<BisectState> {
    if bisect_in_progress(repo) {
        return Err(AppError::General("bisect 会话已在进行中".into()));
    }
    if let Some(b) = bad {
        cli::validate_non_option(b, "提交")?;
    }
    if let Some(g) = good {
        cli::validate_non_option(g, "提交")?;
    }
    // A clean worktree is required: bisect checks out arbitrary commits and
    // would otherwise refuse or, worse, mix local edits into tested revisions.
    if super::branch::has_uncommitted_changes(repo)? {
        return Err(AppError::UncommittedChanges(
            "starting a bisect would discard them".into(),
        ));
    }
    let mut args: Vec<&str> = vec!["start"];
    if let Some(b) = bad {
        args.push(b);
    }
    if let Some(g) = good {
        args.push(g);
    }
    run_bisect(repo, &args)?;
    get_state(repo)
}

pub fn mark(repo: &Repository, verdict: &str, commit: Option<&str>) -> AppResult<BisectState> {
    if !bisect_in_progress(repo) {
        return Err(AppError::General("没有进行中的 bisect 会话".into()));
    }
    let verdict = match verdict {
        "good" => "good",
        "bad" => "bad",
        "skip" => "skip",
        other => return Err(AppError::General(format!("未知的 bisect 标记：{other}"))),
    };
    let mut args: Vec<&str> = vec![verdict];
    if let Some(c) = commit {
        cli::validate_non_option(c, "提交")?;
        args.push(c);
    }
    run_bisect(repo, &args)?;
    get_state(repo)
}

pub fn reset(repo: &Repository) -> AppResult<()> {
    if !bisect_in_progress(repo) {
        return Err(AppError::General("没有进行中的 bisect 会话".into()));
    }
    run_bisect(repo, &["reset"])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo_with_commits() -> (std::path::PathBuf, Repository, Vec<git2::Oid>) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("aigit-bisect-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("mkdir");
        let repo = Repository::init(&root).expect("init");
        let mut oids = Vec::new();
        for i in 0..3 {
            let file = root.join(format!("f{i}.txt"));
            fs::write(&file, format!("v{i}\n")).expect("write");
            let mut index = repo.index().expect("index");
            index
                .add_path(std::path::Path::new(&format!("f{i}.txt")))
                .expect("add");
            index.write().expect("write index");
            let tree_id = index.write_tree().expect("tree");
            let tree = repo.find_tree(tree_id).expect("find tree");
            let sig = Signature::now("t", "t@example.com").expect("sig");
            let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let oid = match parent {
                Some(p) => repo
                    .commit(Some("HEAD"), &sig, &sig, &format!("c{i}"), &tree, &[&p])
                    .expect("commit"),
                None => repo
                    .commit(Some("HEAD"), &sig, &sig, &format!("c{i}"), &tree, &[])
                    .expect("commit"),
            };
            oids.push(oid);
        }
        (root, repo, oids)
    }

    #[test]
    fn start_mark_reset_roundtrip() {
        let (root, repo, oids) = temp_repo_with_commits();

        let state = get_state(&repo).expect("state");
        assert!(!state.in_progress);

        let bad = oids[2].to_string();
        let good = oids[0].to_string();
        let state = start(&repo, Some(&bad), Some(&good)).expect("start");
        assert!(state.in_progress);
        assert!(!state.log.is_empty());

        let state = mark(&repo, "good", None).expect("mark good");
        assert!(state.in_progress || !state.log.is_empty());
        assert_eq!(state.first_bad_commit, Some(bad));

        reset(&repo).expect("reset");
        let state = get_state(&repo).expect("state after reset");
        assert!(!state.in_progress);

        let _ = oids;
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_start_when_already_running() {
        let (root, repo, oids) = temp_repo_with_commits();
        let bad = oids[2].to_string();
        start(&repo, Some(&bad), None).expect("start");
        assert!(start(&repo, Some(&bad), None).is_err());
        reset(&repo).expect("reset");
        fs::remove_dir_all(&root).ok();
    }
}
