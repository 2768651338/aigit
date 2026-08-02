# Privacy

生效日期：2026-08-01。本文描述 aigit 1.0.4 的数据行为。aigit 本身不运营遥测或账户服务，但用户选择的 Git、GitHub 和 AI 服务会按其各自政策处理数据。

## 本机保存的数据

- `%APPDATA%\aigit\config.toml`：模型、endpoint、主题、语言、提示词、索引设置、最近/打开仓库路径；不保存新 API Key/PAT。
- Windows Credential Manager（service `aigit`）：OpenAI、Claude、DeepSeek、云嵌入 Key 和 GitHub PAT。
- 本地应用数据目录：代码索引 JSON、聊天历史和审查结果等功能数据。设置页可以关闭/清除聊天历史、删除当前仓库索引。
- Git 仓库及 Git 配置：由本机 libgit2/系统 Git 读取和修改。

路径、提交作者和对话可能属于个人信息。任何能登录同一系统账户或读取相应目录的程序都可能访问本地文件；请使用操作系统磁盘/账户保护。

## 何时发送数据

| 操作 | 可能发送的内容 | 接收方 |
|---|---|---|
| AI 提交/智能提交/审查 | 所选 diff、路径、提示词 | 当前 AI endpoint |
| 仓库问答 | 问题、对话、提交元数据、显式附件、检索到的索引片段 | 当前 AI endpoint；Ollama 可为本机 |
| 报告 AI 润色 | 经过有限凭据/路径清理的洞察与报告文本 | 当前 AI endpoint |
| 云嵌入 | 分块代码文本、模型名 | 配置的 OpenAI-compatible endpoint |
| push/pull/fetch/clone | Git 对象和认证协商 | 仓库 remote |
| GitHub PR/检查/评论 | 仓库标识、PR 内容、代码评论和认证 | GitHub/GitHub Enterprise 或 `gh` 配置的主机 |
| 打开外链 | URL | 系统浏览器/邮件应用及目标站点 |

应用不主动上传完整本地索引文件。云嵌入只有在 `embedding_provider = "openai_compatible"`、`cloud_embedding_enabled = true` 且 `never_upload_index = false` 三项同时满足时才发送代码块。默认是本机 Ollama且禁止上传。

`never_upload_index` 不会禁止普通云 AI 请求：当用户点击生成、审查、问答或润色时，为完成该操作而选择的 diff/上下文仍会发送。自定义 base URL 可能是代理或第三方服务，用户负责确认其隐私政策。

## 索引过滤与限制

索引只读取 Git index 中的文件，跳过二进制、超限文件、用户 `extra_excludes`，以及 `.env*`、包含 credential/secret 的文件名和常见密钥/证书扩展名。过滤是降低意外暴露的纵深防御，不保证识别所有秘密；请添加项目专用排除规则并在云发送前检查内容。

## 保留与删除

- 在设置中删除当前仓库索引；关闭本地聊天保存并清除历史。
- 在设置中删除 API Key；GitHub PAT 通过对应功能删除，或在 Windows Credential Manager 中删除 `aigit` 条目。
- 删除 `%APPDATA%\aigit\config.toml` 可清除偏好和仓库路径；删除本地应用数据目录可清除索引/历史。操作前退出应用。
- 已发送给第三方的数据必须依据该服务政策在对方处删除；aigit 无法代为撤回。

旧版 TOML 中的明文 `*_api_key` 会在 Windows Credential Manager 可用且写入成功后迁移并移除。迁移失败时保留原值以避免凭据丢失，用户应立即手动处理该文件。

## 更新与联系

当前没有遥测或自动更新检查。隐私行为变化会记录在 [CHANGELOG.md](CHANGELOG.md)。问题请联系 2768651338@qq.com；安全问题请遵循 [SECURITY.md](SECURITY.md)。
