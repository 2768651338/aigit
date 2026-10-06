//! 健康检查扩展：提交历史密钥泄露扫描与代码热点（churn）统计。
//!
//! 两项扫描都从 HEAD 可达的最近提交开始、受配置的提交数上限约束，超出即
//! 截断并在结果中标记；单条结果永远只携带脱敏预览，不携带完整密钥。

use std::collections::{BTreeMap, HashSet};

use git2::{DiffOptions, Repository, Sort};
use serde::Serialize;

use crate::ai::find_secret_previews;
use crate::error::AppResult;

/// 单次密钥扫描命中的条数上限（防止泄露严重的仓库刷出数千条结果）。
pub const MAX_SECRET_HITS: usize = 100;
/// 单个提交参与密钥扫描的最大新增行数，超出跳过该提交的剩余部分。
const MAX_SCAN_LINES_PER_COMMIT: usize = 50_000;

#[derive(Debug, Clone, Serialize)]
pub struct SecretHit {
    pub short_hash: String,
    /// 提交主题，帮助定位是哪次改动引入的。
    pub commit_message: String,
    pub file_path: String,
    /// 密钥模式标签（来自 AI 发送前扫描的同一套模式表）。
    pub kind: String,
    /// 脱敏后的匹配预览（仅保留开头几个字符）。
    pub preview: String,
    /// 新文件中的 1-based 行号。
    pub line_no: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistorySecretScan {
    pub hits: Vec<SecretHit>,
    pub scanned_commits: usize,
    /// `true` 表示因达到 max_commits 而提前截断，更早的历史未扫描。
    pub truncated: bool,
    pub hit_cap_reached: bool,
}

/// 扫描最近 `max_commits` 条提交中**新增**的行，命中疑似密钥即记录。
/// 只看新增行：某个密钥只要在某次提交里出现过，就会在那次提交里被扫到。
pub fn scan_history_secrets(repo: &Repository, max_commits: usize) -> AppResult<HistorySecretScan> {
    let max_commits = max_commits.clamp(100, 100_000);
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    let mut hits: Vec<SecretHit> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut scanned: usize = 0;
    let mut truncated = false;
    let mut hit_cap_reached = false;

    let mut opts = DiffOptions::new();
    opts.context_lines(0);

    for oid in revwalk {
        if scanned >= max_commits {
            truncated = true;
            break;
        }
        let commit = match repo.find_commit(oid?) {
            Ok(commit) => commit,
            Err(_) => continue,
        };
        scanned += 1;
        let Ok(tree) = commit.tree() else { continue };
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let Ok(diff) = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        else {
            continue;
        };
        let short_hash = commit
            .as_object()
            .short_id()
            .ok()
            .and_then(|oid| oid.as_str().map(|value| value.to_string()));
        let subject = commit.summary().unwrap_or("").trim().to_string();

        let mut scanned_lines = 0usize;
        // git2 0.19 的 foreach：第二个参数（binary 回调）是必需的。
        let _ = diff.foreach(
            None,
            &mut |_delta, _weight| true,
            None,
            Some(&mut |delta, _hunk, line| {
                if line.origin() != '+' {
                    return true;
                }
                scanned_lines += 1;
                if scanned_lines > MAX_SCAN_LINES_PER_COMMIT {
                    return false;
                }
                if hits.len() >= MAX_SECRET_HITS {
                    hit_cap_reached = true;
                    return false;
                }
                let content = String::from_utf8_lossy(line.content());
                let path = delta
                    .new_file()
                    .path()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default();
                for (kind, preview) in find_secret_previews(&content) {
                    let key = format!("{path}\u{0}{kind}\u{0}{preview}");
                    if seen.insert(key) {
                        hits.push(SecretHit {
                            short_hash: short_hash.clone().unwrap_or_default(),
                            commit_message: subject.clone(),
                            file_path: path.clone(),
                            kind: kind.to_string(),
                            preview,
                            line_no: line.new_lineno(),
                        });
                    }
                }
                true
            }),
        );
        if hit_cap_reached {
            break;
        }
    }

    Ok(HistorySecretScan {
        hits,
        scanned_commits: scanned,
        truncated,
        hit_cap_reached,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct CodeHotspot {
    pub path: String,
    pub commit_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct HotspotReport {
    pub hotspots: Vec<CodeHotspot>,
    pub scanned_commits: usize,
    pub truncated: bool,
}

/// 统计最近 `max_commits` 条提交中被改动最频繁的文件 Top N。
/// 不做重命名检测：重命名会表现为旧路径删除 + 新路径新增，两条各自计数。
pub fn analyze_code_hotspots(
    repo: &Repository,
    top_n: usize,
    max_commits: usize,
) -> AppResult<HotspotReport> {
    let top_n = top_n.clamp(1, 100);
    let max_commits = max_commits.clamp(100, 50_000);
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut scanned: usize = 0;
    let mut truncated = false;

    let mut opts = DiffOptions::new();
    opts.context_lines(0);

    for oid in revwalk {
        if scanned >= max_commits {
            truncated = true;
            break;
        }
        let commit = match repo.find_commit(oid?) {
            Ok(commit) => commit,
            Err(_) => continue,
        };
        scanned += 1;
        let Ok(tree) = commit.tree() else { continue };
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let Ok(diff) = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        else {
            continue;
        };
        for delta in diff.deltas() {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|path| path.to_string_lossy().to_string());
            if let Some(path) = path {
                if !path.is_empty() {
                    *counts.entry(path).or_default() += 1;
                }
            }
        }
    }

    let mut hotspots: Vec<CodeHotspot> = counts
        .into_iter()
        .map(|(path, commit_count)| CodeHotspot { path, commit_count })
        .collect();
    hotspots.sort_by(|a, b| {
        b.commit_count
            .cmp(&a.commit_count)
            .then_with(|| a.path.cmp(&b.path))
    });
    hotspots.truncate(top_n);

    Ok(HotspotReport {
        hotspots,
        scanned_commits: scanned,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Signature, Time};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> Repository {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aigit-health-extra-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let repo = Repository::init(&dir).expect("init repo");
        let mut config = repo.config().expect("repo config");
        config.set_bool("core.autocrlf", false).expect("autocrlf");
        repo
    }

    fn commit_file(repo: &Repository, path: &str, content: &str, message: &str, time: i64) {
        let workdir = repo.workdir().expect("workdir");
        fs::write(workdir.join(path), content).expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(std::path::Path::new(path)).expect("add");
        index.write().expect("index write");
        let signature =
            Signature::new("tester", "tester@example.com", &Time::new(time, 0)).expect("signature");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("tree");
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .expect("commit");
    }

    #[test]
    fn secret_scan_detects_added_aws_key_with_redacted_preview() {
        let repo = temp_repo("secrets");
        // 运行时拼装示例密钥，避免源码出现可用的凭据字面量。
        let fake_key = format!("AKIA{}", "IOSFODNN7EXAMPLE");
        commit_file(
            &repo,
            "config.py",
            &format!("aws_access_key_id = \"{fake_key}\"\nregion = \"cn-north-1\"\n"),
            "feat: add aws config",
            1_700_000_000,
        );

        let scan = scan_history_secrets(&repo, 500).expect("scan");

        assert_eq!(scan.scanned_commits, 1);
        assert!(!scan.truncated);
        assert_eq!(scan.hits.len(), 1);
        let hit = &scan.hits[0];
        assert_eq!(hit.file_path, "config.py");
        assert!(hit.kind.contains("AWS"));
        // 预览必须脱敏：绝不能包含完整密钥。
        assert!(!hit.preview.contains(&fake_key));
        assert!(hit.preview.starts_with("AKIA"));
        assert!(hit.preview.contains('…'));
    }

    #[test]
    fn secret_scan_ignores_clean_history_and_reports_truncation() {
        let repo = temp_repo("clean");
        commit_file(
            &repo,
            "a.txt",
            "hello world\n",
            "chore: init",
            1_700_000_000,
        );
        commit_file(
            &repo,
            "b.txt",
            "no secrets here\n",
            "docs: add note",
            1_700_000_100,
        );

        let scan = scan_history_secrets(&repo, 500).expect("scan");
        assert!(scan.hits.is_empty());
        assert_eq!(scan.scanned_commits, 2);

        // 上限压到最小值 100 不会截断这个只有 2 条提交的仓库。
        let tiny = scan_history_secrets(&repo, 100).expect("scan");
        assert!(!tiny.truncated);
        assert_eq!(tiny.scanned_commits, 2);
    }

    #[test]
    fn hotspots_rank_files_by_commit_count() {
        let repo = temp_repo("hotspots");
        commit_file(&repo, "a.txt", "one\n", "feat: a1", 1_700_000_000);
        commit_file(&repo, "b.txt", "one\n", "feat: b1", 1_700_000_100);
        commit_file(&repo, "a.txt", "two\n", "fix: a2", 1_700_000_200);
        commit_file(&repo, "a.txt", "three\n", "fix: a3", 1_700_000_300);

        let report = analyze_code_hotspots(&repo, 10, 500).expect("hotspots");

        assert_eq!(report.scanned_commits, 4);
        assert!(!report.truncated);
        assert_eq!(report.hotspots.len(), 2);
        assert_eq!(report.hotspots[0].path, "a.txt");
        assert_eq!(report.hotspots[0].commit_count, 3);
        assert_eq!(report.hotspots[1].path, "b.txt");
        assert_eq!(report.hotspots[1].commit_count, 1);
    }
}
