# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，并遵循语义化版本。

## [1.0.7] - 2026-08-28

### Fixed

- 修复"仓库产生了文件变更但变更列表仍显示无改动"：窗口重新聚焦/恢复可见时强制刷新仓库状态，变更页挂载时立即刷新一次（此前仅有失焦时会被 WebView2 节流的 5 秒轮询）。
- 手动刷新入口（Ctrl+R、右键菜单、刷新按钮、添加 .gitignore 后）改为强制执行，不再被在途的轮询或提交/推送操作静默跳过。
- 仓库状态刷新结果按请求序号落库，仅应用最新一次请求的结果，防止先发出的旧响应后到时覆盖新数据。
- 修复 amend 成功后提示语误显示为"提交成功"。

## [1.0.5] - 2026-08-25

### Added

- 历史、Stash 与 Tag 面板展示提交的完整改动文件列表：结构化差异默认折叠为文件清单（路径 + 增删行数），点击文件逐行展开。

### Changed

- 打开的仓库列表从顶部标签栏移至侧边栏，支持分支名显示、悬停关闭与空状态引导，内容区高度相应增加。

## [Unreleased]

### Added

- 侧边栏"打开的仓库"列表支持鼠标拖动调整排序：拖动中显示半透明行与插入位置指示线，顺序随打开仓库配置一并持久化；同时为窗口内 HTML5 拖放启用 Tauri `dragDropEnabled: false` 并全局兜底拦截外部文件拖入，防止 WebView 误导航。

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
