# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，并遵循语义化版本。

## [Unreleased]

### Added

- Tauri 最小 CSP、受限外部 URL 与导出路径安全边界。
- 项目贡献、安全和隐私文档。

### Changed

- 移除前端通用 shell 权限和未使用的文件系统读/遍历权限。

## [1.0.4] - 2026-08-01

### Added

- 智能原子提交计划、结构化 AI 审查、流式 AI 与请求取消。
- 本地聊天历史和可删除的本地代码索引；Ollama 与显式 opt-in 云嵌入。
- GitHub PR workflow，支持 `gh`、PAT/API 与浏览器 fallback。
- remote、tag、stash、submodule、merge/rebase、冲突解决和历史高级操作。
- 仓库洞察、贡献日历、进度时间线、报告与 SVG/PNG/GIF/Markdown/文本导出。
- 浅色、深色和跟随系统主题。

### Security

- AI 与 GitHub 凭据保存在 Windows Credential Manager；支持迁移旧明文 API Key。
- 对命令参数、remote/ref、审查输出、索引大小与敏感文件执行校验和限制。

[Unreleased]: https://github.com/2768651338/aigit/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/2768651338/aigit/releases/tag/v1.0.4
