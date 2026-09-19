# Changelog

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，并遵循语义化版本。

## [1.0.13] - 2026-09-19

### Added

- 模型方案：可保存多套 AI 连接配置（服务商、模型、Base URL、生成参数与各自的 API 密钥），设置页与侧边栏底部均可一键切换，无需重复填写。首次启动自动把现有配置导入为第一个方案；密钥仍存放在系统凭据库，配置文件保持无密钥。

## [1.0.12] - 2026-09-13

### Added

- 文件浏览器视图（Ctrl+3）：目录懒加载树、文件名 / 本地语义双模式搜索、内容预览（二进制检测、512 KB 上限、LFS 指针识别）、单文件历史与行级 blame。
- AI 冲突解决助手：冲突解决器内流式生成合并建议，经内容级密钥检测与用户确认后写入。
- AI 审查一键修复：审查发现可携带补丁，应用前经 `git apply --check` 预校验，成功后自动标记已解决。
- 聊天会话搜索：按会话标题与消息内容过滤，命中高亮并显示摘要。
- 恢复面板（HEAD reflog）：找回被 reset / rebase 甩开的提交，支持检出或就地建分支。
- 提交历史"加载更多"分页加载。
- 命令面板（Ctrl+K 或 ?）：视图跳转、常用操作与快捷键速查。
- GitHub Issues 浏览与创建（gh CLI 与 PAT API 双通道）。
- git worktree 管理：列表、新建（可选检出分支）、移除、一键作为仓库标签打开。
- git hooks 管理器：白名单内 hook 的查看、编辑与保存（Unix 自动补可执行位）。
- bisect 二分定位向导：开始 / 标记 / 跳过 / 结束与日志查看。
- 历史整理：从所选提交到 HEAD 的改写（reword）、相邻合并（squash）与丢弃（drop）；经脏工作区与范围校验，旧历史可从恢复面板找回。
- 状态栏多仓库聚合弹层：各仓库分支、领先 / 落后、暂存与合并状态一览。
- diff 行 / 代码块右键"在 AI 对话中解释"。
- 提交信息草稿按仓库持久化，重启不丢失。
- 设置页新增界面字体族（`ui.font_family`）。
- 新增自定义（OpenAI 兼容）AI provider：自定义 base URL、模型与 API Key。

### Changed

- 新增 AI provider（custom）进入凭据服务白名单；Provider 配置结构与既有 openai/deepseek 复用同一通道。

## [1.0.11] - 2026-09-12

### Added

- Tauri 最小 CSP、受限外部 URL 与导出路径安全边界。
- 项目贡献、安全和隐私文档。
- AI 发送内容的内容级密钥检测：命中疑似凭据时中断请求，用户确认后才可继续发送。
- 克隆支持取消（`clone_repo_task`），并改走系统 git CLI，私有仓库 HTTPS 克隆复用系统凭据助手。
- 切换分支前的未提交改动防护：检测到脏工作区/暂存区时拒绝切换，用户确认丢弃后才强制执行。
- 前端 ESLint 门禁（`npm run lint`，react-hooks 规则接入 CI）。
- merge / stash / repo 模块与前端 IPC 契约层的回归测试。
- 仓库内文件统一模态组件的键盘可达性：Esc 关闭、焦点陷阱与初始焦点；右键菜单支持 ↑↓/Home/End 导航。
- 新增通用输入对话框（重命名会话等），替代无法本地化的 `window.prompt`。
- 仓库洞察、错误提示与崩溃页文案接入 i18n；提交历史相对时间按界面语言本地化。
- 聊天历史与代码索引在 Windows 上使用 DPAPI（当前用户范围）加密存储。

### Changed

- 移除前端通用 shell 权限和未使用的文件系统读/遍历权限。
- 移除 `opener:allow-open-path` capability：仓库内文件打开改为后端命令并在服务端校验路径；外部链接仅允许 https 与 mailto。
- AI 流式请求移除 90 秒总超时，改为逐块空闲超时，长回复不再被中途切断。
- 大文件 diff 默认渐进渲染（超过 1500 行先显示前缀，可一键展开全部）。
- 仓库状态订阅改为细粒度 selector，消除轮询期间的全量重渲染；聊天流式输出改为独立轻量状态，结束后一次性落库。
- config.toml 与聊天历史存储串行化，消除并发读改写丢失更新的竞态。
- 本地代码索引状态查询改用快速路径（stat 指纹缓存），索引与 embedding 写盘移出锁外；embedding 改为二进制 sidecar 存储，JSON 体积大幅缩小。
- 代码索引 embedding 二进制 sidecar 与 AI 发送内容的密钥扫描接入 DPAPI 加密存储。
- 仓库操作日志上限收紧（`get_log` 最多 1000 条）、单文件 diff 的 untracked 扫描按 pathspec 收窄、仓库洞察按日期剪枝提交图遍历。
- diff 解析按文件增量定位，消除 O(n²) 文件查找；git 输出脱敏与提交计划校验的正则改为进程内只编译一次。
- 启动恢复多仓库时并行校验保存的仓库路径，白屏时间不再随标签数线性增长。
- diff 行与聊天消息气泡组件 memo 化：选中行、流式输出只重渲染受影响的条目。
- 设置页拆分为独立 section 组件；仓库 store 的面板域操作（stash/tag/submodule/merge/history）拆分至 `repoStorePanels.ts`。
- 破坏性操作确认统一走 Tauri 原生对话框；面板内错误只在内联横幅展示，不再与 toast 双显。
- README/SECURITY/PRIVACY 不再写死版本号，CHANGELOG 按版本降序重排并补齐链接定义。

### Fixed

- 菜单图布局中的无效赋值（ESLint `no-useless-assignment` 发现）。
- 仓库打开对话框的克隆地址校验与后端白名单对齐（拒绝 `http://`、`git://` 与本地路径）。
- 切换分支成功提示在失败或用户取消时不再误报（store 返回布尔结果）。
- 复制成功提示的定时器随组件卸载清理；会话标题按码点截断，emoji 不再显示为乱码。
- 凭据扫描器的测试合成样例改为运行时拼接，消除静态扫描的硬编码凭据误报（Mimosa 复扫 0 发现）。
- 崩溃兜底边界覆盖顶层 Provider 并展示诊断 ID；未暂存提交的错误文案引导先暂存。
- 依赖升级：thiserror 2、dirs 6；tokio features 按实际使用收窄。
- 新增 `check:updater` 构建断言：配置 updater endpoints 时必须同时配置 HTTPS 公钥。

## [1.0.10] - 2026-09-11

### Fixed

- 关于页版本号改为构建期注入（`check:version` 保证与 tauri.conf/Cargo 同源），修复始终显示 v1.0.4、不随发版更新的问题。
- 依赖安全修复：升级 h2 至 0.4.19（RUSTSEC-2026-0258，经 reqwest 引入）；npm 侧非破坏性升级 browserslist、nanoid（高危）与 postcss、baseline-browser-mapping；vitest 链的 2 个 moderate 需大版本升级，暂保留。
- 恢复 CI 的 rustfmt/clippy 检查通过：全量 `cargo fmt` 格式化，`PathBuf` 导入移入测试模块。

## [1.0.9] - 2026-09-11

### Fixed

- 历史详情面板展示提交的完整信息：主题完整换行显示，多行提交的正文不再被省略（此前仅显示首行截断）；历史搜索同时匹配正文内容。
- 修复标题栏品牌区无法从 "aigit" 标签上发起窗口拖动的问题，并补齐 start-dragging 窗口权限。
- 修复提交/amend/提交并推送流程中切换仓库标签导致忙碌与错误状态错位：状态现钉定在发起操作的仓库上。

## [1.0.8] - 2026-08-28

### Added

- 侧边栏"打开的仓库"列表支持鼠标拖动调整排序：拖动中显示半透明行与插入位置指示线，顺序随打开仓库配置一并持久化；同时为窗口内 HTML5 拖放启用 Tauri `dragDropEnabled: false` 并全局兜底拦截外部文件拖入，防止 WebView 误导航。

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

[1.0.12]: https://github.com/2768651338/aigit/releases/tag/v1.0.12
[1.0.11]: https://github.com/2768651338/aigit/releases/tag/v1.0.11
[1.0.10]: https://github.com/2768651338/aigit/releases/tag/v1.0.10
[1.0.9]: https://github.com/2768651338/aigit/releases/tag/v1.0.9
[1.0.8]: https://github.com/2768651338/aigit/releases/tag/v1.0.8
[1.0.7]: https://github.com/2768651338/aigit/releases/tag/v1.0.7
[1.0.5]: https://github.com/2768651338/aigit/releases/tag/v1.0.5
[1.0.4]: https://github.com/2768651338/aigit/releases/tag/v1.0.4
