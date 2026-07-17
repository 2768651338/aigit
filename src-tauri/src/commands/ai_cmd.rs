use crate::ai::{self, ChatMessage};
use crate::config::AppConfig;
use crate::error::{AppError, AppResult};
use crate::git;

/// Built-in default system prompts. Exposed publicly so the config command
/// can return them to the frontend for "reset to default" functionality.
pub const DEFAULT_COMMIT_MSG_SYSTEM: &str = r#"你是一位资深软件工程师，擅长撰写清晰、简洁的 Git 提交信息，遵循 Conventional Commits 规范。

重要：所有提交信息必须使用简体中文撰写（type 和 scope 保持英文）。

规则：
- 格式：type(scope): 中文描述
- 类型：feat, fix, docs, style, refactor, perf, test, chore, build, ci
- 标题行不超过 72 个字符
- 标题使用祈使语气，正文用完整句子解释
- 如果改动较复杂，在正文中解释"为什么"
- 不要包含任何解释说明，直接输出提交信息

输出示例：
feat(auth): 添加 OAuth2 登录流程

基于新的认证抽象层实现 Google 和 GitHub OAuth2 提供者，
为过期的会话添加了令牌刷新逻辑。"#;

pub const DEFAULT_CODE_REVIEW_SYSTEM: &str = r#"你是一位资深代码审查员。请分析提供的 Git diff，给出可执行、简洁的反馈。

重要：所有回复必须使用简体中文撰写（代码、文件路径、技术术语保持原文）。

使用 Markdown 格式组织你的回复，包含以下章节：
## 概述
用一句话说明本次改动做了什么。

## 发现的问题
列出任何 bug、安全问题或逻辑错误。使用严重程度标签：[严重] [警告] [提示]。如果没有问题，写"未发现问题。"

## 改进建议
给出具体的改进建议，必要时附上简短的代码示例。

## 风格说明
关于代码风格/约定的观察，保持简短。

请具体引用文件路径和行内容。跳过没有可报告内容的章节。不要冗长。"#;

pub const DEFAULT_REPO_CHAT_SYSTEM: &str = r#"你是一位 AI 助手，帮助开发者理解和处理 Git 仓库。你可以访问对话中提供的仓库上下文（提交历史、文件 diff、分支信息）。

重要：所有回复必须使用简体中文撰写（代码、文件路径、技术术语保持原文）。

指南：
- 回答关于仓库历史、改动和结构的问题
- 引用提交时，使用其短哈希和提交信息
- 代码示例使用带语言标签的代码块
- 简洁而全面
- 如果上下文不足以准确回答，请说明需要哪些额外信息"#;

/// Returns the user-customized commit-message prompt if set, otherwise the default.
fn commit_msg_prompt(config: &AppConfig) -> &str {
    let custom = &config.prompts.commit_message;
    if custom.trim().is_empty() {
        DEFAULT_COMMIT_MSG_SYSTEM
    } else {
        custom
    }
}

/// Returns the user-customized code-review prompt if set, otherwise the default.
fn code_review_prompt(config: &AppConfig) -> &str {
    let custom = &config.prompts.code_review;
    if custom.trim().is_empty() {
        DEFAULT_CODE_REVIEW_SYSTEM
    } else {
        custom
    }
}

/// Returns the user-customized repo-chat prompt if set, otherwise the default.
fn repo_chat_prompt(config: &AppConfig) -> &str {
    let custom = &config.prompts.repo_chat;
    if custom.trim().is_empty() {
        DEFAULT_REPO_CHAT_SYSTEM
    } else {
        custom
    }
}

#[tauri::command]
pub async fn generate_commit_message(
    repo_path: String,
    config: AppConfig,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&repo_path)?;
    // Prefer staged changes; fall back to all working-directory changes so
    // users can generate a commit message without staging first.
    let diffs = git::diff::get_staged_diff(&repo, None)?;
    let diffs = if diffs.is_empty() {
        git::diff::get_workdir_diff(&repo, None)?
    } else {
        diffs
    };

    if diffs.is_empty() {
        return Err(AppError::Ai(
            "No changes to analyze. Modify some files first.".to_string(),
        ));
    }

    let diff_text = format_diffs(&diffs);
    let provider = ai::get_provider(&config.ai.active_provider)?;
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: format!(
            "Analyze this Git diff and generate an appropriate commit message:\n\n```diff\n{diff_text}\n```"
        ),
    }];

    provider
        .chat(commit_msg_prompt(&config), &messages, &config.ai)
        .await
}

#[tauri::command]
pub async fn review_code(
    repo_path: String,
    file_path: Option<String>,
    staged_only: bool,
    config: AppConfig,
) -> AppResult<String> {
    let repo = git::repo::open_repo(&repo_path)?;
    let diffs = if staged_only {
        git::diff::get_staged_diff(&repo, file_path.as_deref())?
    } else {
        git::diff::get_workdir_diff(&repo, file_path.as_deref())?
    };

    if diffs.is_empty() {
        return Err(AppError::Ai("No changes to review.".to_string()));
    }

    let diff_text = format_diffs(&diffs);
    let provider = ai::get_provider(&config.ai.active_provider)?;
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: format!(
            "Review this Git diff for bugs, security issues, and improvements:\n\n```diff\n{diff_text}\n```"
        ),
    }];

    provider
        .chat(code_review_prompt(&config), &messages, &config.ai)
        .await
}

#[tauri::command]
pub async fn repo_chat(
    messages: Vec<ChatMessage>,
    repo_path: Option<String>,
    config: AppConfig,
) -> AppResult<String> {
    let provider = ai::get_provider(&config.ai.active_provider)?;

    let mut context = String::new();
    if let Some(path) = &repo_path {
        if let Ok(repo) = git::repo::open_repo(path) {
            if let Ok(info) = git::repo::get_repo_info(&repo) {
                context.push_str(&format!(
                    "Repository: {} (branch: {})\n",
                    info.name,
                    info.current_branch.as_deref().unwrap_or("HEAD")
                ));
            }
            if let Ok(log) = git::branch::get_log(&repo, 20) {
                context.push_str("\nRecent commits:\n");
                for entry in log.iter() {
                    context.push_str(&format!(
                        "  {} {} ({})\n",
                        &entry.short_hash, entry.message, entry.author
                    ));
                }
            }
        }
    }

    let base_prompt = repo_chat_prompt(&config);
    let system_prompt = if context.is_empty() {
        base_prompt.to_string()
    } else {
        format!("{base_prompt}\n\n--- Repository Context ---\n{context}")
    };

    provider.chat(&system_prompt, &messages, &config.ai).await
}

/// Returns the built-in default prompts so the frontend can offer
/// "reset to default" and show placeholders.
#[tauri::command]
pub fn get_default_prompts() -> AppResult<DefaultPrompts> {
    Ok(DefaultPrompts {
        commit_message: DEFAULT_COMMIT_MSG_SYSTEM.to_string(),
        code_review: DEFAULT_CODE_REVIEW_SYSTEM.to_string(),
        repo_chat: DEFAULT_REPO_CHAT_SYSTEM.to_string(),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DefaultPrompts {
    pub commit_message: String,
    pub code_review: String,
    pub repo_chat: String,
}

fn format_diffs(diffs: &[git::FileDiff]) -> String {
    let mut output = String::new();
    for diff in diffs {
        let path = diff.old_path.as_ref().unwrap_or(&diff.path);
        output.push_str(&format!("diff --git a/{path} b/{}\n", diff.path));
        for hunk in &diff.hunks {
            output.push_str(&format!("{}\n", hunk.header));
            for line in &hunk.lines {
                let prefix = match line.line_type.as_str() {
                    "add" => "+",
                    "delete" => "-",
                    _ => " ",
                };
                output.push_str(&format!("{prefix}{}\n", line.content));
            }
        }
        output.push('\n');
    }
    output
}
