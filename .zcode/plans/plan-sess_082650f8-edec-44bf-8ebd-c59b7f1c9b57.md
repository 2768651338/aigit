# Git 洞察与内容生成完整套件

## 已确认的产品边界

- 新增独立的 **“洞察”** 页面，作为第 5 个业务页；设置页顺延为 `Ctrl/Cmd + 6`。
- 默认统计 **所有本地分支、远程分支和标签可达的提交**，按 commit hash 去重；不包含 reflog 和 stash。
- 首期包含：
  1. 项目贡献日历图
  2. 开发者活跃度热力图与排行
  3. 项目进展时间线动画
  4. 周报生成
  5. 开源项目介绍生成
- 导出支持：**SVG、PNG、GIF、Markdown/文本**。根据你选择的“GIF 优先”，本期不引入 FFmpeg，也不提供 MP4；避免增加 sidecar、安装包体积和跨平台维护成本。
- 文案先由稳定的本地模板生成；用户主动点击“AI 润色”后才复用现有 AI 配置发送聚合统计，不自动向外部服务发送仓库数据。AI 未配置或调用失败时保留模板结果。
- 开发者默认按规范化 email 归并；页面支持手动合并身份，规则按仓库持久化。

## 1. 后端：完整历史统计命令

- 新增 `src-tauri/src/git/insights.rs`，并在 `src-tauri/src/git/mod.rs` 暴露模块及统计 DTO。
- 新增异步 Tauri 命令 `get_repository_insights`，在阻塞线程中执行 git2 遍历，避免卡住 UI；在 `src-tauri/src/commands/git_cmd.rs` 和 `src-tauri/src/lib.rs` 注册。
- 遍历所有 `refs/heads/*`、`refs/remotes/*`、`refs/tags/*` 可达提交，并用 OID 集合去重；忽略无法 peel 到 commit 的引用，空仓库返回结构化空结果。
- 对每个唯一提交收集：hash、作者名/email、时间、摘要、父提交数、命中的 refs；按日期、周、月份、星期和小时聚合。
- 返回面向可视化的紧凑 DTO，而不是把完整提交数组塞进现有 `repoStore.log`：
  - 仓库名称、统计起止时间、总提交数、贡献者数、分支/标签数
  - 每日贡献数（贡献日历）
  - 每位作者的提交数、活跃天数、首末提交日期、24×7 活跃矩阵
  - 时间线桶的累计提交数/贡献者数和阶段增量
  - 标签里程碑及用于周报的近期提交摘要
- 合并提交按一次贡献计数；首期不逐提交计算代码增删行，避免完整历史 diff 在大型仓库上产生不可控耗时。进展动画以累计提交、活跃开发者、阶段提交量和版本标签体现进度。
- 增加 Rust 单元测试，覆盖：多 refs 去重、空仓库、作者 email 规范化、时区日期归桶、合并提交、标签里程碑。

## 2. 前端数据层与纯统计工具

- 在 `src/types/index.ts` 增加洞察 DTO、作者归并规则和导出选项类型。
- 在 `src/services/git.ts` 增加 `getRepositoryInsights()` 调用，不改变现有分支图只取 100 条日志的行为。
- 新增 `src/utils/insights.ts`：
  - 应用手动作者别名并重新聚合作者数据
  - 贡献强度分级、日期范围补零、时间线帧生成
  - 周报与开源介绍的本地 Markdown 模板
  - 文件名清理和导出尺寸计算
- 作者归并规则按仓库标识存入 localStorage；只保存邮箱映射和展示名，不写入仓库文件。提供添加、编辑、移除和恢复默认规则。
- 洞察页在仓库切换或首次进入时自动加载；提供刷新按钮、空仓库态、错误态和大型仓库加载态。请求期间禁用重复触发。

## 3. 新增“洞察”页面与可视化组件

- 新增 `src/pages/InsightsView.tsx`，沿用现有页面的 `flex flex-col h-full`、固定标题栏和滚动内容布局。
- 新增 `src/components/insights/`：
  - `ContributionCalendar`：GitHub 风格全年/全历史年份切换贡献日历，显示日期与提交数 tooltip。
  - `DeveloperActivityHeatmap`：开发者筛选、星期×小时热力矩阵、贡献者排行和活跃天数。
  - `ProgressTimeline`：按月/周播放的累计进展图，支持播放、暂停、拖动、速度选择和重新播放；标签作为里程碑标记。
  - `IdentityMergeDialog`：选择多个 email 归并到统一开发者名称。
  - `ReportGenerator`：周报/开源介绍切换、可编辑预览、复制、导出 Markdown、AI 润色。
- 图表以自绘 SVG/CSS 为主，不引入大型图表框架，匹配现有 `BranchGraph` 的轻量实现和主题变量。
- 周报默认取最近一个完整自然周，并允许切换当前周；开源介绍使用全历史摘要、贡献者规模、活跃趋势、版本里程碑生成。模板内容不虚构功能，只陈述可由 Git 历史推导的信息。

## 4. SVG、PNG、GIF 和文本导出

- 新增 `src/utils/exportInsights.ts`：
  - SVG：序列化独立、带主题颜色和必要样式的图表 SVG。
  - PNG：将 SVG 绘制到 Canvas 后输出高分辨率 PNG Blob。
  - GIF：从 `ProgressTimeline` 的确定性帧序列逐帧绘制 Canvas，使用轻量 GIF 编码依赖生成动图；限制最大尺寸/帧数并显示编码进度，防止大仓库导致内存失控。
  - Markdown/文本：保存模板或 AI 润色后的当前内容。
- 使用 Tauri save dialog 让用户明确选择目标路径；文本通过 `writeTextFile`，二进制通过 `writeFile` 保存。
- 更新 `src-tauri/capabilities/default.json` 增加最小必要的二进制写权限，不增加 shell 执行权限。该文件当前已有未提交修改，实施时先基于现有内容做最小合并，绝不覆盖用户改动。
- 导出按钮提供 loading、成功/失败 toast、取消保存静默返回、重复点击保护；文件名包含仓库名、图表类型和日期。

## 5. AI 润色流程

- 复用 `aiService.repoChat()` 和现有 `AppConfig`，不新增供应商协议。
- 仅发送聚合后的统计、标签和提交摘要，不发送 diff、源码、仓库绝对路径或作者 email；作者只使用页面展示名。
- 用户点击“AI 润色”时显示明确操作；未配置 AI 时提示并继续使用本地模板。
- 使用约束明确的 prompt，要求保持 Markdown、不得虚构 Git 数据中不存在的成果；返回内容仍可编辑、复制和导出。

## 6. 导航、图标、国际化与可访问性

- 扩展 `ViewType` 为 `insights`，更新 `App.tsx`、`Sidebar.tsx` 和快捷键映射：Changes 1、Branches 2、Review 3、Chat 4、Insights 5、Settings 6。
- 在 `Icons.tsx` 添加洞察/图表所需图标，保持现有图标 API 和样式。
- 在中英文语言文件补齐导航、统计指标、加载/空态、作者归并、动画、导出、周报和 AI 润色文案。
- 图表提供文本摘要、键盘可操作控件、ARIA label；不只靠颜色表达强度，并兼容浅色/深色主题。

## 7. 测试与验证

- 新增纯工具测试：日期补零、时区边界、email 归并、强度等级、时间线帧、Markdown 模板和安全文件名。
- 新增 `InsightsView`/关键组件测试：自动加载、空仓库、错误状态、作者归并、播放控制、复制、模板回退、AI 成功/失败、导出取消及重复点击保护。
- 增加导出测试，mock Canvas、Blob、save dialog 和 fs API，验证 MIME、文件扩展名及资源 URL 回收。
- 更新导航测试以覆盖第 6 个页面及输入框内快捷键忽略逻辑。
- 最终运行并如实报告：
  - `npm test`
  - `npm run build`
  - `cargo fmt --check`
  - `cargo test`
  - `cargo check`
- 实施过程中遵循静态安全检查：不开放任意路径拼接或 shell 执行，不将 email/源码发送给 AI，并保留当前工作区所有已有未提交修改。完成代码后再询问是否进行语义级轻量安全扫描。