# Contributing

感谢参与 aigit。提交改动表示你同意按 Apache-2.0 许可证提供贡献。

## 开发环境

需要 Node.js 18+、Rust 1.77+、Git 和 WebView2。Windows 是当前打包目标；`gh` 只在测试 GitHub CLI workflow 时需要。

```bash
npm install
npm run tauri dev
```

不要提交真实 API Key、PAT、凭据导出、私人仓库内容、生成的 `dist/`/`target/` 或本地日志。

## 变更流程

1. 从最新默认分支创建主题分支。
2. 保持改动聚焦；复用现有模块和类型。
3. 修改行为时补测试；用户可见功能、配置、隐私或依赖变化需同步 README/CHANGELOG。
4. Tauri command 必须验证不可信输入；外部进程使用固定程序和参数数组，禁止 shell 拼接。
5. 新增 capability、CSP source、网络 endpoint、持久化数据或云发送前，说明最小权限理由并更新 SECURITY/PRIVACY。
6. 提交 PR 前运行：

```bash
npm run check:version
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## 代码约定

- TypeScript 保持严格类型，避免 `any`；Rust 错误通过 `AppError` 返回。
- 不在日志、错误或测试快照中输出凭据和完整敏感内容。
- 文件路径必须由用户选择或被约束到已打开仓库/应用数据目录。
- Markdown 保持原始 HTML 禁用；外链通过统一 URL 白名单。
- 新依赖应说明必要性，并更新 lockfile。

## PR 描述

写明目的、主要实现、测试结果、UI 截图（如适用）、安全/隐私影响及迁移方法。安全漏洞不要公开提 PR，请按 [SECURITY.md](SECURITY.md) 报告。
