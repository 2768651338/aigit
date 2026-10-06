//! 仓库提交风格自学习：统计最近若干条提交的语言、Conventional 前缀、
//! 标题长度等真实风格，生成注入 AI 提交信息提示词的参考块。
//!
//! 统计对象是提交主题/正文文本（来自仓库历史），属于不可信数据：示例主题
//! 一律截断到有限长度，且整块只作为风格参考追加，不改变主提示词的约束。

use std::collections::BTreeMap;
use std::sync::OnceLock;

use git2::{Repository, Sort};
use regex::Regex;
use serde::Serialize;

use crate::error::AppResult;

/// 风格分析默认采样的最近提交数。
pub const DEFAULT_SAMPLE_COMMITS: usize = 200;

/// 单条示例主题的最长字符数，防止异常长主题撑爆提示词。
const MAX_SUBJECT_CHARS: usize = 120;
/// 注入提示词的示例主题条数上限。
const MAX_SAMPLE_SUBJECTS: usize = 5;

fn conventional_prefix_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|wip)(\([^)]*\))?!?:\s+\S",
        )
        .expect("valid conventional-commit pattern")
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct PrefixCount {
    pub prefix: String,
    pub count: usize,
}

/// 最近提交的风格画像。所有比例字段为 0-100 的百分数。
#[derive(Debug, Clone, Serialize)]
pub struct CommitStyle {
    /// 实际采样的提交条数（空仓库为 0，调用方应跳过注入）。
    pub sample_count: usize,
    pub uses_conventional: bool,
    pub conventional_percent: u32,
    /// Conventional 类型 → 出现次数，按次数降序。
    pub prefix_counts: Vec<PrefixCount>,
    pub avg_subject_chars: u32,
    /// 含中日韩字符的提交主题占比，用于判断历史提交语言。
    pub cjk_subject_percent: u32,
    pub trailing_period_percent: u32,
    /// 正文使用「- 」/「* 」列表的提交占比。
    pub bulleted_body_percent: u32,
    /// `"zh"` / `"en"` / `"mixed"`。
    pub language_hint: String,
    pub sample_subjects: Vec<String>,
}

impl CommitStyle {
    /// 生成追加到提交信息系统提示词末尾的风格参考块。
    ///
    /// 主提示词（内置默认或用户自定义）只应被"补充信息"，因此这里明确声明
    /// 与其冲突时以主提示词为准，避免历史风格覆盖用户明确写下的规则。
    pub fn prompt_block(&self) -> String {
        let language = match self.language_hint.as_str() {
            "zh" => "以中文为主",
            "en" => "以英文为主",
            _ => "中英混合",
        };
        let mut lines = vec![format!(
            "## 仓库提交风格参考（基于最近 {} 条真实提交自动统计，尽量保持一致；与本提示词上方规则冲突时以上方规则为准）",
            self.sample_count
        )];
        lines.push(format!("- 提交主题语言：{language}"));
        if self.uses_conventional && !self.prefix_counts.is_empty() {
            let top: Vec<String> = self
                .prefix_counts
                .iter()
                .take(4)
                .map(|prefix| prefix.prefix.clone())
                .collect();
            lines.push(format!(
                "- 使用 Conventional Commits 前缀，常见类型：{}",
                top.join("、")
            ));
        } else {
            lines.push("- 历史提交未使用 Conventional 前缀，保持普通句式".to_string());
        }
        lines.push(format!(
            "- 标题平均长度约 {} 字符（硬上限 72）",
            self.avg_subject_chars
        ));
        if self.trailing_period_percent < 20 {
            lines.push("- 标题末尾不加句号".to_string());
        }
        if self.bulleted_body_percent >= 30 {
            lines.push("- 复杂提交的正文常用「- 」列表逐条说明".to_string());
        }
        if !self.sample_subjects.is_empty() {
            lines.push("- 近期提交主题示例：".to_string());
            for subject in &self.sample_subjects {
                lines.push(format!("  - {subject}"));
            }
        }
        lines.join("\n")
    }
}

fn contains_cjk(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(
            c,
            '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
        )
    })
}

fn percent(part: usize, total: usize) -> u32 {
    if total == 0 {
        return 0;
    }
    ((part as f64 / total as f64) * 100.0).round() as u32
}

/// 分析 HEAD 可达的最近 `sample_limit` 条提交（merge 提交计入采样）。
/// 空仓库（unborn HEAD）返回 Err，由调用方决定跳过注入。
pub fn analyze_commit_style(repo: &Repository, sample_limit: usize) -> AppResult<CommitStyle> {
    let sample_limit = sample_limit.clamp(10, 1_000);
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    let mut subjects: Vec<String> = Vec::new();
    let mut bodies: Vec<String> = Vec::new();
    for oid in revwalk.take(sample_limit) {
        let commit = repo.find_commit(oid?)?;
        let summary = commit.summary().unwrap_or("").trim();
        if summary.is_empty() {
            continue;
        }
        subjects.push(summary.chars().take(MAX_SUBJECT_CHARS).collect());
        bodies.push(commit.body().unwrap_or("").to_string());
    }

    let total = subjects.len();
    let mut prefix_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut subject_chars: usize = 0;
    let mut cjk_subjects: usize = 0;
    let mut trailing_period: usize = 0;
    let mut bulleted_body: usize = 0;

    for (subject, body) in subjects.iter().zip(bodies.iter()) {
        if let Some(caps) = conventional_prefix_pattern().captures(subject) {
            *prefix_counts.entry(caps[1].to_string()).or_default() += 1;
        }
        subject_chars += subject.chars().count();
        if contains_cjk(subject) {
            cjk_subjects += 1;
        }
        if subject.ends_with('.') {
            trailing_period += 1;
        }
        if body
            .lines()
            .any(|line| line.trim_start().starts_with("- ") || line.trim_start().starts_with("* "))
        {
            bulleted_body += 1;
        }
    }

    let conventional: usize = prefix_counts.values().sum();
    let mut sorted_prefixes: Vec<PrefixCount> = prefix_counts
        .into_iter()
        .map(|(prefix, count)| PrefixCount { prefix, count })
        .collect();
    sorted_prefixes.sort_by(|a, b| b.count.cmp(&a.count).then(a.prefix.cmp(&b.prefix)));

    let cjk_percent = percent(cjk_subjects, total);
    let language_hint = if cjk_percent >= 60 {
        "zh"
    } else if cjk_percent <= 10 {
        "en"
    } else {
        "mixed"
    };

    Ok(CommitStyle {
        sample_count: total,
        uses_conventional: total > 0 && conventional * 2 >= total,
        conventional_percent: percent(conventional, total),
        prefix_counts: sorted_prefixes,
        avg_subject_chars: if total == 0 {
            0
        } else {
            (subject_chars / total) as u32
        },
        cjk_subject_percent: cjk_percent,
        trailing_period_percent: percent(trailing_period, total),
        bulleted_body_percent: percent(bulleted_body, total),
        language_hint: language_hint.to_string(),
        sample_subjects: subjects.into_iter().take(MAX_SAMPLE_SUBJECTS).collect(),
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
        let dir = std::env::temp_dir().join(format!("aigit-commit-style-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let repo = Repository::init(&dir).expect("init repo");
        let mut config = repo.config().expect("repo config");
        config.set_bool("core.autocrlf", false).expect("autocrlf");
        repo
    }

    fn commit_on(repo: &Repository, message: &str, time: i64) {
        let signature =
            Signature::new("tester", "tester@example.com", &Time::new(time, 0)).expect("signature");
        let mut index = repo.index().expect("index");
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
    fn empty_repository_reports_zero_samples() {
        let repo = temp_repo("empty");
        assert!(analyze_commit_style(&repo, DEFAULT_SAMPLE_COMMITS).is_err());
    }

    #[test]
    fn detects_conventional_prefixes_and_language() {
        let repo = temp_repo("conventional");
        commit_on(&repo, "feat(auth): 添加登录功能", 1_700_000_000);
        commit_on(&repo, "fix(core): 修复空指针", 1_700_000_100);
        commit_on(&repo, "docs: update API 文档", 1_700_000_200);
        commit_on(&repo, "update readme without prefix", 1_700_000_300);

        let style = analyze_commit_style(&repo, DEFAULT_SAMPLE_COMMITS).expect("style");

        assert_eq!(style.sample_count, 4);
        assert_eq!(style.conventional_percent, 75);
        assert!(style.uses_conventional);
        let prefixes: Vec<&str> = style
            .prefix_counts
            .iter()
            .map(|prefix| prefix.prefix.as_str())
            .collect();
        assert_eq!(prefixes, vec!["fix", "docs", "feat"]);
        assert_eq!(style.cjk_subject_percent, 75);
        assert_eq!(style.language_hint, "mixed");
        assert_eq!(style.sample_subjects.len(), 4);
    }

    #[test]
    fn english_history_is_detected_as_english() {
        let repo = temp_repo("english");
        commit_on(&repo, "add pagination to the log view", 1_700_000_000);
        commit_on(&repo, "fix a typo in the sidebar label", 1_700_000_100);

        let style = analyze_commit_style(&repo, DEFAULT_SAMPLE_COMMITS).expect("style");

        assert_eq!(style.language_hint, "en");
        assert!(!style.uses_conventional);
        assert_eq!(style.trailing_period_percent, 0);
    }

    #[test]
    fn prompt_block_states_style_without_overriding_base_rules() {
        let repo = temp_repo("prompt");
        commit_on(&repo, "feat(auth): 添加登录功能", 1_700_000_000);
        commit_on(&repo, "fix(core): 修复空指针", 1_700_000_100);

        let style = analyze_commit_style(&repo, DEFAULT_SAMPLE_COMMITS).expect("style");
        let block = style.prompt_block();

        assert!(block.contains("基于最近 2 条真实提交"));
        assert!(block.contains("feat、fix") || block.contains("fix、feat"));
        assert!(block.contains("以上方规则为准"));
    }

    #[test]
    fn commit_message_body_bullets_are_counted() {
        let repo = temp_repo("bullets");
        commit_on(
            &repo,
            "feat: add export\n\n- 支持 SVG 导出\n- 支持 PNG 导出",
            1_700_000_000,
        );
        commit_on(&repo, "chore: bump deps", 1_700_000_100);

        let style = analyze_commit_style(&repo, DEFAULT_SAMPLE_COMMITS).expect("style");
        assert_eq!(style.bulleted_body_percent, 50);
    }
}
