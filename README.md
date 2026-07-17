# aigit

> AI 驱动的 Windows 原生 Git 客户端 — 写提交、做审查、问仓库，一句话搞定。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-0078D4.svg)](https://github.com/tauri-apps/tauri)
[![Built with Tauri](https://img.shields.io/badge/Built_with-Tauri_v2-FFC131.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584.svg)](https://www.rust-lang.org)

`aigit` 把大语言模型塞进了一个轻量级的桌面 Git 客户端里，让 AI 真正参与到日常的版本控制工作流中：自动生成提交信息、审查代码改动、用自然语言问答仓库历史。所有 Git 操作都在本地执行，AI 调用走你自己的 API Key，数据不出本地除非你主动调用云端模型。

## 目录

- [核心特性](#核心特性)
- [快速开始](#快速开始)
- [配置详解](#配置详解)
- [功能演示](#功能演示)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [构建产物](#构建产物)
- [可扩展性](#可扩展性)
- [FAQ](#faq)
- [许可证](#许可证)

## 核心特性

### AI 集成

| 功能 | 说明 |
|---|---|
| **AI 生成提交信息** | 基于已暂存的 diff 自动生成 Conventional Commits 规范的提交信息，默认简体中文输出（type 和 scope 保持英文） |
| **AI 代码审查** | 分析改动并给出可执行的安全/bug/改进建议，输出 Markdown 格式带严重程度标签 |
| **AI 仓库问答** | 用自然语言询问仓库历史、改动、分支等，AI 自动注入最近 20 条提交作为上下文 |
| **可插拔 AI 提供商** | 内置 OpenAI / Claude / DeepSeek / Ollama（本地模型）四种支持，通过 `AiProvider` trait 抽象 |
| **自定义提示词** | 三个内置提示词均可在线编辑，留空回退默认；支持"重置为默认"和"使用默认"两种回退方式 |

### Git 操作

| 功能 | 说明 |
|---|---|
| **改动视图** | 双栏文件列表（已暂存/未暂存）、点击查看 diff、`+`/`-` 按钮快速暂存/取消暂存 |
| **暂存管理** | 单文件暂存、全部暂存、全部取消暂存、单文件撤销修改（`git checkout --`） |
| **提交** | 本地提交 / 提交并推送 / 仅推送三选一，支持 `Ctrl+Enter` 快捷键 |
| **推送 / 拉取** | 走系统 `git` 命令，复用 SSH key 和 credential helper，不依赖 libgit2 的认证机制 |
| **分支管理** | 创建、切换、删除分支，本地/远程分组展示，可视化分支图（带合并提交标记） |
| **历史浏览** | 点击任意提交查看完整 patch，带行级语法着色（增行绿、删行红、hunk header 酸绿色） |
| **启动恢复** | 记住上次打开的仓库，下次启动自动恢复（路径失效时静默跳过） |
| **自动刷新** | 改动视图每 5 秒自动刷新一次，无需手动点击 |

### 界面与交互

| 特性 | 说明 |
|---|---|
| **深色主题** | `#0a0a0a` 背景 + `#d4ff3a` 酸性绿强调色，editorial-level 排版 |
| **国际化** | 中英文一键切换，默认中文，设置保存即时生效 |
| **原生弹窗** | 推送/拉取成功用系统对话框提醒，破坏性操作（如丢弃修改）二次确认 |
| **响应式布局** | 最低 900×600，支持自由缩放，左右分栏自动适配 |
| **状态栏** | 底部状态栏实时显示当前分支、↑ahead/↓behind、已暂存/已修改文件数、HEAD 哈希 |
| **字体可调** | 12-18px 字体大小可调，影响全局 |

## 截图预览

```
┌──────────────────────────────────────────────────────────────────┐
│  ai │ aigit                                                       │
├─────┼────────────────────────────────────────────────────────────┤
│     │ 改动                                       │ diff viewer     │
│ repo│ ┌─────────────────┬─────────────────────┐ │                │
│     │ │ 已暂存 (2)      │ src/main.rs         │ │ +  fn new()    │
│ aigit│ │  M main.rs     │ +++ b/src/main.rs   │ │ -  let x = 0;  │
│     │ │  A utils.rs     │ @@ -10,3 +10,5 @@   │ │                │
│ 改动│ │                 │ +fn new() -> Self { │ │                │
│ 分支│ │ 改动 (1)        │ +    Self { x: 1 }  │ │                │
│ 审查│ │  M README.md    │ +}                  │ │                │
│ 对话│ ├─────────────────┴─────────────────────┤ │                │
│ 设置│ │ [AI 生成]  提交信息...(Ctrl+Enter)    │ │                │
│     │ │  ↑1  2 已暂存  [提交并推送] [提交]    │ │                │
└─────┴────────────────────────────────────────────────────────────┘
```

## 快速开始

### 环境要求

| 依赖 | 最低版本 | 说明 |
|---|---|---|
| **Node.js** | 18 | 前端构建工具链 |
| **Rust** | 1.77 | 后端编译（含 `cargo`） |
| **Git** | 任意 | 已加入 PATH，push/pull/discard 依赖系统 git |
| **WebView2 Runtime** | — | Windows 10/11 通常已预装，缺失时安装包会自动下载 |

### 三种使用方式

#### 方式 1：直接运行调试版（最快）

无需安装，从源码构建后双击即可：

```bash
npm install
npm run build
# 需要 Rust 工具链
cargo build --manifest-path src-tauri/Cargo.toml
# 双击运行
src-tauri\target\debug\aigit.exe
```

#### 方式 2：开发模式（热重载）

```bash
npm install
npx tauri dev
```

#### 方式 3：生产构建（生成安装包）

```bash
npm install
npx tauri build
```

构建完成后在 [src-tauri/target/release/bundle/](src-tauri/target/release/bundle/) 目录下会生成：
- `msi/aigit_1.0.0_x64_en-US.msi` — Windows Installer（企业部署推荐）
- `nsis/aigit_1.0.0_x64-setup.exe` — NSIS 轻量安装包

## 配置详解

首次启动会在 `%APPDATA%\aigit\config.toml` 创建默认配置。所有字段均可在应用内 **设置** 页面修改，保存即时生效。

### 完整配置示例

```toml
[ai]
active_provider = "openai"        # openai | claude | deepseek | ollama
openai_api_key = ""
openai_model = "gpt-4o-mini"
openai_base_url = "https://api.openai.com/v1"
claude_api_key = ""
claude_model = "claude-sonnet-4-20250514"
claude_base_url = "https://api.anthropic.com/v1"
deepseek_api_key = ""
deepseek_model = "deepseek-chat"
deepseek_base_url = "https://api.deepseek.com/v1"
ollama_base_url = "http://localhost:11434"
ollama_model = "qwen2.5-coder:7b"
temperature = 0.7
max_tokens = 2048

[ui]
theme = "dark"
font_size = 14
show_diff_inline = true
language = "zh"                   # zh | en

[prompts]                         # 留空使用内置默认提示词
commit_message = ""
code_review = ""
repo_chat = ""

[[recent_repos]]
```

### 字段说明

#### `[ai]` — AI 提供商配置

| 字段 | 说明 |
|---|---|
| `active_provider` | 当前激活的提供商，决定走哪个 API。`openai` 和 `deepseek` 共用 OpenAI 协议 |
| `*_api_key` | 对应提供商的 API Key，Ollama 无需 Key |
| `*_model` | 模型名，如 `gpt-4o-mini` / `claude-sonnet-4-20250514` / `deepseek-chat` / `qwen2.5-coder:7b` |
| `*_base_url` | API 基础 URL，可改为代理或自建端点（如 Azure OpenAI、Ollama 远程实例） |
| `temperature` | 生成温度 0.0-2.0，0 最精确，2 最创意，默认 0.7 |
| `max_tokens` | 单次响应最大 token 数，256-8192，默认 2048 |

#### `[ui]` — 界面配置

| 字段 | 说明 |
|---|---|
| `theme` | 主题，目前固定 `dark` |
| `font_size` | 全局字体大小 12-18px |
| `show_diff_inline` | 是否内联显示 diff |
| `language` | 界面语言 `zh` / `en` |

#### `[prompts]` — 自定义提示词

三个字段均为字符串，留空则使用内置默认提示词（见 [ai_cmd.rs](src-tauri/src/commands/ai_cmd.rs)）：

| 字段 | 用途 |
|---|---|
| `commit_message` | 生成提交信息时的 system prompt |
| `code_review` | 代码审查时的 system prompt |
| `repo_chat` | 仓库问答时的 system prompt（会自动追加仓库上下文） |

#### `[[recent_repos]]` — 最近仓库列表

应用每次打开仓库会自动追加到列表首位，最多保留 10 条，启动时自动恢复第 1 条。

## 功能演示

### AI 生成提交信息

1. 打开一个有改动的 Git 仓库
2. 在 **改动** 页面，点击文件右侧的 `+` 按钮暂存改动
3. 在底部提交面板点击 **AI 生成** 按钮
4. AI 会基于已暂存的 diff 生成符合 Conventional Commits 规范的中文提交信息
5. 可直接编辑后点击 **提交** 或 **提交并推送**

### AI 代码审查

1. 切换到 **AI 审查** 页面
2. 选择审查范围：**已暂存** 或 **全部改动**
3. 可选指定单个文件，或审查所有改动文件
4. 点击 **运行审查**，AI 会输出包含以下章节的 Markdown 报告：
   - 概述
   - 发现的问题（带 `[严重]`/`[警告]`/`[提示]` 严重程度标签）
   - 改进建议
   - 风格说明

### AI 仓库问答

1. 切换到 **AI 对话** 页面
2. 在底部输入框输入问题（如"最近一次提交是关于什么的？"）
3. AI 会自动注入仓库上下文（仓库名、当前分支、最近 20 条提交）
4. **Enter** 发送，**Shift+Enter** 换行

### 历史提交查看

1. 切换到 **分支** 页面
2. 在右侧历史列表中点击任意提交
3. 右侧会弹出该提交的完整 patch，带语法着色
4. 再次点击同一提交可关闭面板

### 撤销未暂存修改

1. 在 **改动** 页面，未暂存文件行 hover 时会显示撤销图标
2. 点击撤销图标
3. 弹出原生确认对话框（"确定要丢弃 xxx 的未暂存修改吗？此操作不可恢复。"）
4. 确认后执行 `git checkout -- <file>`

## 技术架构

### 分层架构

```
┌─────────────────────────────────────────────────┐
│  前端 (React + TypeScript)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Pages   │→ │  Stores  │→ │  Services    │  │
│  │ (Views)  │  │(Zustand) │  │(Tauri invoke)│  │
│  └──────────┘  └──────────┘  └──────┬───────┘  │
└──────────────────────────────────────┼──────────┘
                                       │ Tauri IPC
┌──────────────────────────────────────┴──────────┐
│  后端 (Rust)                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Commands │→ │   Git    │  │     AI       │  │
│  │  (IPC)   │  │ (libgit2)│  │ (Providers)  │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 桌面框架 | Tauri | v2 | Rust + WebView2 桌面应用 |
| 后端语言 | Rust | 2021 edition | 类型安全、零成本抽象 |
| Git 库 | libgit2 | 0.19 | 纯本地 Git 操作（status/diff/commit/branch） |
| HTTP 客户端 | reqwest | 0.12 | 调用 AI API |
| 异步运行时 | tokio | 1 | 异步任务调度 |
| 序列化 | serde + serde_json + toml | 1 | 配置持久化、API 通信 |
| 前端框架 | React | 18 | UI 渲染 |
| 类型系统 | TypeScript | 5 | 类型安全 |
| 构建工具 | Vite | 5 | 前端打包 |
| 样式 | Tailwind CSS | 3 | 原子化 CSS |
| 状态管理 | Zustand | 4 | 轻量状态库 |
| 国际化 | i18next + react-i18next | 26/17 | 中英文切换 |
| 打包 | MSI / NSIS | — | Windows 安装包 |

### Git 操作策略

项目采用**双轨制**处理 Git 操作：

- **libgit2 (Rust 原生)** — 用于 `status`、`diff`、`commit`、`branch`、`log` 等纯本地操作。优势：速度快、无外部依赖、类型安全。
- **系统 `git` 命令** — 用于 `push`、`pull`、`discard`（`checkout --`）。原因：libgit2 在 Windows 上不支持 SSH agent forwarding 和 credential helper，认证不可靠。走系统 git 可以复用用户已配置的 SSH key 和 credential.helper。

### 错误处理

统一的 `AppError` 枚举覆盖所有错误场景，通过 `serde::Serialize` 序列化为字符串传给前端：

```rust
pub enum AppError {
    Git(git2::Error),        // libgit2 错误
    Io(std::io::Error),      // IO 错误
    Http(reqwest::Error),    // HTTP 请求错误
    Json(serde_json::Error), // JSON 解析错误
    Config(String),          // 配置错误
    Ai(String),              // AI 提供商错误
    NotARepo(String),        // 非 Git 仓库
    General(String),         // 其他通用错误
}
```

前端通过 `formatError()` 工具函数统一处理 Tauri IPC 返回的各种错误对象格式，避免出现 `[object Object]` 这样的无效错误信息。

## 项目结构

```
aigit/
├── src/                              # 前端源码
│   ├── components/
│   │   ├── common/
│   │   │   ├── Icons.tsx             # SVG 图标库
│   │   │   └── MarkdownRenderer.tsx  # Markdown 渲染组件
│   │   ├── git/
│   │   │   ├── BranchGraph.tsx       # 分支图 + 历史 diff 查看
│   │   │   ├── CommitPanel.tsx       # 提交面板（AI 生成、提交、推送、拉取）
│   │   │   ├── DiffViewer.tsx        # 结构化 diff 查看器
│   │   │   └── FileStatusList.tsx    # 文件状态列表（暂存/取消暂存/撤销）
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # 侧边栏导航
│   │   │   └── StatusBar.tsx         # 底部状态栏
│   │   └── settings/
│   │       └── PromptEditor.tsx      # 可折叠的提示词编辑器
│   ├── pages/
│   │   ├── ChangesView.tsx           # 改动页（自动刷新）
│   │   ├── BranchesView.tsx          # 分支页
│   │   ├── ReviewView.tsx            # AI 审查页
│   │   ├── ChatView.tsx              # AI 对话页
│   │   └── SettingsView.tsx          # 设置页
│   ├── services/
│   │   ├── ai.ts                     # AI 命令封装（含 ensureTauri 检查）
│   │   ├── config.ts                 # 配置命令封装
│   │   └── git.ts                    # Git 命令封装（18 个方法）
│   ├── stores/
│   │   ├── aiStore.ts                # AI 状态（生成/审查/对话）
│   │   └── repoStore.ts              # 仓库状态（含 push/pull/discard）
│   ├── i18n/
│   │   ├── index.ts                  # i18next 配置
│   │   └── locales/
│   │       ├── zh.json               # 中文翻译
│   │       └── en.json               # 英文翻译
│   ├── utils/
│   │   ├── dialog.ts                 # 原生弹窗（message + confirm）
│   │   ├── env.ts                    # Tauri 环境检测
│   │   └── error.ts                  # formatError 工具
│   ├── types/
│   │   └── index.ts                  # 与 Rust 镜像的 TypeScript 类型
│   ├── App.tsx                       # 应用根组件（含启动恢复逻辑）
│   ├── main.tsx                      # React 入口
│   └── index.css                     # Tailwind + 自定义样式
├── src-tauri/
│   ├── src/
│   │   ├── ai/
│   │   │   ├── mod.rs                # AiProvider trait + get_provider
│   │   │   ├── openai.rs             # OpenAI/DeepSeek 实现
│   │   │   ├── claude.rs             # Claude 实现
│   │   │   └── ollama.rs             # Ollama 本地实现
│   │   ├── commands/
│   │   │   ├── ai_cmd.rs             # AI 命令 + 默认提示词常量
│   │   │   ├── config_cmd.rs         # 配置命令
│   │   │   ├── git_cmd.rs            # Git 命令（20+ 个）
│   │   │   └── mod.rs
│   │   ├── config/
│   │   │   ├── mod.rs
│   │   │   └── settings.rs           # AppConfig + PromptsConfig + TOML 持久化
│   │   ├── git/
│   │   │   ├── mod.rs                # 共享数据结构 (FileStatus, DiffHunk, ...)
│   │   │   ├── repo.rs               # 仓库打开/发现/初始化/克隆
│   │   │   ├── status.rs             # 文件状态
│   │   │   ├── diff.rs               # diff 计算
│   │   │   ├── commit.rs             # 暂存/提交/丢弃
│   │   │   ├── branch.rs             # 分支/历史
│   │   │   └── remote.rs             # 推送/拉取（走系统 git）
│   │   ├── error.rs                  # AppError 统一错误
│   │   ├── lib.rs                    # Tauri 应用入口 + 命令注册
│   │   └── main.rs                   # main 入口
│   ├── Cargo.toml
│   └── tauri.conf.json
├── LICENSE                           # Apache 2.0
├── README.md
└── package.json
```

## 开发指南

### 常用命令

```bash
# 安装依赖
npm install

# 前端开发（仅启动 Vite，无 Tauri 外壳）
npm run dev

# 前端构建
npm run build

# Tauri 开发模式（热重载，需 Rust 工具链）
npx tauri dev

# Tauri 生产构建（生成 exe + MSI + NSIS）
npx tauri build

# 仅编译 Rust 后端（debug）
cargo build --manifest-path src-tauri/Cargo.toml

# 仅编译 Rust 后端（release）
cargo build --manifest-path src-tauri/Cargo.toml --release
```

### 添加新的 Git 命令

1. 在 [src-tauri/src/git/](src-tauri/src/git/) 对应模块（如 `commit.rs`）添加 Rust 函数
2. 在 [src-tauri/src/commands/git_cmd.rs](src-tauri/src/commands/git_cmd.rs) 添加 `#[tauri::command]` 包装
3. 在 [src-tauri/src/lib.rs](src-tauri/src/lib.rs) 的 `invoke_handler!` 宏中注册命令
4. 在 [src/services/git.ts](src/services/git.ts) 添加 TypeScript 调用（带 `ensureTauri()` 检查）
5. 在 [src/stores/repoStore.ts](src/stores/repoStore.ts) 添加状态管理方法
6. 在 UI 组件中调用

### 添加新的 AI 提供商

1. 在 [src-tauri/src/ai/](src-tauri/src/ai/) 新建 `<provider>.rs`，实现 `AiProvider` trait 的 `chat()` 方法
2. 在 [src-tauri/src/ai/mod.rs](src-tauri/src/ai/mod.rs) 的 `get_provider()` 函数中注册
3. 在 [src-tauri/src/config/settings.rs](src-tauri/src/config/settings.rs) 的 `AiProviderConfig` 添加该提供商的字段
4. 在 [src/pages/SettingsView.tsx](src/pages/SettingsView.tsx) 添加 UI 配置表单
5. 在 [src/types/index.ts](src/types/index.ts) 镜像 TypeScript 类型

### 添加新的界面语言

1. 在 [src/i18n/locales/](src/i18n/locales/) 新建 `<lang>.json`，参考 `zh.json` 结构
2. 在 [src/i18n/index.ts](src/i18n/index.ts) 注册新语言
3. 在 [src/pages/SettingsView.tsx](src/pages/SettingsView.tsx) 的语言切换按钮中添加选项

## 构建产物

| 产物 | 路径 | 大小 | 说明 |
|---|---|---|---|
| 独立 exe | `src-tauri/target/release/aigit.exe` | ~16 MB | 无需安装，双击运行 |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/aigit_1.0.0_x64_en-US.msi` | ~6 MB | Windows Installer，支持组策略部署 |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/aigit_1.0.0_x64-setup.exe` | ~4 MB | 轻量安装包 |
| 前端打包 | `dist/assets/index-*.js` + `index-*.css` | ~433 KB（gzip 131 KB） | 嵌入 exe |

### 编译统计

- **Rust 编译**：涉及约 515 个 crate，release 全量编译约 7 分钟（首次）
- **前端构建**：351 个模块，约 3 秒
- **目标架构**：x64
- **警告**：仅 linker 创建 .lib 文件的提示性警告，不影响功能

## 可扩展性

项目通过两个核心抽象实现高度可扩展：

### `AiProvider` trait

```rust
#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn chat(
        &self,
        system_prompt: &str,
        messages: &[ChatMessage],
        config: &AiProviderConfig,
    ) -> AppResult<String>;

    fn name(&self) -> &str;
}
```

新增 AI 提供商只需实现 `chat()` 方法并在 `get_provider()` 注册一行代码。目前已实现：
- `OpenAiProvider` — 支持 OpenAI 和 DeepSeek（共用 OpenAI 协议）
- `ClaudeProvider` — Anthropic Claude
- `OllamaProvider` — 本地 Ollama 模型

### Git 模块化组织

Git 操作按功能拆分为 6 个文件：

| 模块 | 职责 |
|---|---|
| `repo.rs` | 仓库打开、发现、初始化、克隆、信息查询 |
| `status.rs` | 文件状态查询 |
| `diff.rs` | 工作区/暂存区 diff 计算 |
| `commit.rs` | 暂存、取消暂存、提交、amend、丢弃修改 |
| `branch.rs` | 分支管理、历史日志、提交 diff |
| `remote.rs` | 推送、拉取（走系统 git 命令） |

新增 Git 命令只需在对应模块加函数，在 `commands/git_cmd.rs` 暴露为 Tauri 命令即可。

## FAQ

### Q: 为什么 AI 生成的提交信息是英文？

A: 默认提示词已明确要求"所有提交信息必须使用简体中文撰写（type 和 scope 保持英文）"。如果仍是英文，请检查 [配置](#配置详解) 中的 `prompts.commit_message` 是否被自定义成了英文提示词，清空该项即可回退到默认中文提示词。

### Q: 推送失败提示"无法调用 git 命令"？

A: push/pull/discard 依赖系统 `git` 命令。请确认：
1. 已安装 Git for Windows 并加入系统 PATH
2. 在终端运行 `git --version` 能正常输出版本号

### Q: 推送失败提示认证错误？

A: aigit 不自己处理认证，而是复用系统 git 的认证配置。请确认：
1. 在仓库目录下手动执行 `git push` 能成功
2. SSH key 已添加到 ssh-agent（`ssh-add -l` 可见）
3. 或 credential helper 已配置（`git config --global credential.helper`）

### Q: AI 调用报错"此功能仅在 Tauri 桌面应用中可用"？

A: 这说明你在浏览器中访问了开发服务器。aigit 的 AI/Git 功能依赖 Tauri IPC，必须运行在 Tauri WebView 中。请双击 `aigit.exe` 运行，或使用 `npx tauri dev` 启动完整桌面应用。

### Q: 配置文件在哪里？

A: Windows 系统下位于 `%APPDATA%\aigit\config.toml`，即 `C:\Users\<用户名>\AppData\Roaming\aigit\config.toml`。

### Q: 支持 macOS / Linux 吗？

A: 代码层面兼容（Tauri 跨平台），但当前 `tauri.conf.json` 的 bundle target 仅配置了 `msi` 和 `nsis`。若要支持其他平台，需在 `bundle.targets` 中添加 `dmg`（macOS）或 `deb`/`AppImage`（Linux），并可能需要调整图标资源。

### Q: 如何使用本地 Ollama 模型？

A:
1. 安装 [Ollama](https://ollama.ai)
2. 拉取模型：`ollama pull qwen2.5-coder:7b`
3. 启动 Ollama 服务：`ollama serve`
4. 在 aigit 设置页选择 Ollama 提供商，填写 `http://localhost:11434` 和模型名

### Q: 启动时为什么自动打开了上次的仓库？

A: 这是 [启动恢复](#核心特性) 功能，配置文件 `recent_repos` 首位即最近仓库。如果路径已被移动或删除，会静默跳过并停留在"未打开仓库"状态，不会报错。

## 快捷键

| 快捷键 | 功能 | 位置 |
|---|---|---|
| `Ctrl+Enter` | 提交 | 提交信息输入框 |
| `Enter` | 新建分支 | 分支名输入框 |
| `Enter` | 发送消息 | AI 对话输入框 |
| `Shift+Enter` | 换行 | AI 对话输入框 |

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 授权。

```
Copyright 2026 aigit

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## 致谢

- [Tauri](https://tauri.app) — 轻量级跨平台桌面应用框架
- [libgit2](https://libgit2.org) — 可嵌入的 Git 库
- [React](https://react.dev) — UI 框架
- [Tailwind CSS](https://tailwindcss.com) — 原子化 CSS 框架
- [Zustand](https://github.com/pmndrs/zustand) — 轻量状态管理
- [i18next](https://www.i18next.com) — 国际化框架
