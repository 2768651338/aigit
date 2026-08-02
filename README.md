# aigit

AI 驱动的 Windows 桌面 Git 客户端。当前版本 **1.0.4**，基于 Tauri 2、React 18 与 Rust 2021。

> Git 与索引存储默认在本机完成；调用 OpenAI、Claude、DeepSeek 或任何自定义/云端兼容服务时，所选 diff、提交历史、问题、报告或索引片段会发送到该服务。使用前请阅读 [PRIVACY.md](PRIVACY.md)。

## 功能

- 多仓库 Tab、启动会话恢复、状态与 diff 自动刷新。
- 工作区/暂存区 diff、逐文件及批量暂存、撤销、提交、amend、推送和拉取。
- 分支图与历史；分支、remote、stash、tag、submodule、merge/rebase、cherry-pick、revert、reset 与冲突解决。
- 智能原子提交计划：AI 分组、计划校验、逐组暂存和提交。
- AI 提交信息、结构化代码审查、流式仓库问答、可编辑提示词与请求取消。
- 本地聊天历史（可关闭和清除）与本地代码索引；敏感文件、二进制和用户排除规则默认跳过。
- GitHub PR 列表、详情、检查、创建、checkout、浏览器 compare，以及逐条确认后发布行内评论。
- 贡献日历、进度时间线、仓库洞察和周报/项目简介；支持 SVG、PNG、GIF、Markdown、文本导出。
- 中文/英文界面，浅色、深色和跟随系统主题，12–18 px 字号。
- Windows Credential Manager 保存 AI API Key、嵌入 Key 与 GitHub PAT；配置文件不写入新凭据。

## 环境要求

| 依赖 | 要求 | 用途 |
|---|---|---|
| Node.js | 18+ | 前端与测试 |
| Rust | 1.77+ | Tauri 后端 |
| Git | PATH 可用 | 网络 Git 与部分高级操作 |
| WebView2 | Windows 10/11 通常自带 | 桌面 WebView |
| GitHub CLI `gh` | 可选 | 完整 PR workflow；执行 `gh auth login` 后使用 |

没有 `gh` 时，可使用存储在 Credential Manager 中的 GitHub PAT 调用 API；未配置任何认证时仍可打开 compare/create 页面。PR checkout 必须使用已认证的 `gh`，行内评论必须使用 PAT。

## 安装、开发与验证

```bash
npm install
npm run dev                 # 仅 Vite，Git/Tauri IPC 不可用
npm run tauri dev           # 完整桌面开发模式
npm run typecheck           # tsc --noEmit
npm test                    # Vitest
npm run build               # tsc + Vite 生产构建
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build         # Windows MSI/NSIS
```

生产产物位于 `src-tauri/target/release/` 和 `src-tauri/target/release/bundle/`。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 配置

Windows 配置位于 `%APPDATA%\aigit\config.toml`。以下示例与 1.0.4 的序列化结构一致；`recent_repos`、`open_repos` 是 TOML 字符串数组，不是 array-of-tables。API Key/PAT 不属于该文件。

```toml
recent_repos = []
open_repos = []
# active_repo = "C:\\work\\project" # 无激活仓库时省略

[ai]
active_provider = "openai" # openai | claude | deepseek | ollama
openai_model = "gpt-4o-mini"
openai_base_url = "https://api.openai.com/v1"
claude_model = "claude-sonnet-4-20250514"
claude_base_url = "https://api.anthropic.com/v1"
deepseek_model = "deepseek-chat"
deepseek_base_url = "https://api.deepseek.com/v1"
ollama_base_url = "http://localhost:11434"
ollama_model = "qwen2.5-coder:7b"
temperature = 0.7
max_tokens = 2048

[ui]
theme = "system" # light | dark | system
font_size = 14
show_diff_inline = true
language = "zh" # zh | en

[prompts]
commit_message = ""
code_review = ""
repo_chat = ""

[index]
enabled = true
never_upload_index = true
embedding_provider = "ollama" # ollama | openai_compatible
ollama_embedding_base_url = "http://localhost:11434"
ollama_embedding_model = "nomic-embed-text"
cloud_embedding_enabled = false
cloud_embedding_base_url = "https://api.openai.com/v1"
cloud_embedding_model = "text-embedding-3-small"
extra_excludes = ["*.min.js", "*.map", "*.lock"]
max_file_bytes = 524288
max_chunks = 20000
chunk_lines = 120
chunk_overlap = 20
max_embedding_chars = 12000
top_k = 6
max_context_tokens = 8000
```

配置保存采用原子替换。旧版本 `*_api_key` 明文字段在 Windows 上会迁移到 Credential Manager，确认安全存储成功后从 TOML 删除。非 Windows 平台目前没有安全凭据后端。

## 数据、凭据和云发送边界

- libgit2、系统 `git`、本地报告生成、聊天历史与索引文件均在本机运行/保存。
- AI 提交、智能提交、审查、对话和“AI 润色”会把完成请求所需内容发送给当前 AI endpoint。自定义 base URL 代表你信任该端点。
- 索引默认使用本机 Ollama。云嵌入需同时选择 `openai_compatible`、启用 `cloud_embedding_enabled` 并关闭 `never_upload_index`；此时代码块会发送给配置的嵌入端点。
- 即使 `never_upload_index = true`，普通云 AI 功能仍会发送用户明确要求处理的 diff/附件/仓库上下文；该选项只约束“索引内容用于云嵌入”。
- Git push/pull 与 GitHub PR 操作会把 Git/PR 数据发送到仓库 remote/GitHub。
- 详细保存位置、排除规则、删除方法与第三方处理方见 [PRIVACY.md](PRIVACY.md)。

## Tauri 安全边界

- WebView 使用最小 CSP；不允许远程脚本、对象、frame 或表单提交。
- Markdown 不启用原始 HTML。链接仅允许 `https:`, `http:`, `mailto:`，经校验后交给系统默认应用打开；拒绝 `javascript:`, `data:`, `file:` 和相对 URL。
- 前端没有通用 shell 权限。外部进程由 Rust 后端以参数数组执行固定的 `git`/`gh` 程序，不经过 shell。
- 文件系统 capability 仅保留导出所需写权限。导出必须先由原生保存对话框返回绝对路径，且扩展名必须与编码格式匹配；默认文件名会清除路径分隔符和非法字符。
- 原生“打开目录”对话框只负责用户选择仓库；仓库文件访问由受控 Rust command 完成。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 升级策略

1. 查看 [CHANGELOG.md](CHANGELOG.md) 的不兼容变化和隐私变化。
2. 退出 aigit，并备份 `%APPDATA%\aigit\config.toml`（凭据需在 Credential Manager 单独管理）。
3. 从可信发布页下载并覆盖安装；仓库、Git 配置和系统凭据不会随卸载包迁移。
4. 启动后运行必要的索引重建；索引格式升级时旧缓存可能被忽略。

1.0.4 已注册 updater 组件，但没有 endpoint、公钥，且不生成 updater artifacts，因此**不会自动联网检查或静默升级**。启用自动升级前必须配置 HTTPS endpoint、签名公钥和签名发布流程，并更新隐私/安全文档。

## 许可证

[Apache License 2.0](LICENSE)。
