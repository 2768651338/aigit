# Security Policy

## 支持范围

当前仅对最新发布版本和默认分支提供安全修复。1.0.4 是当前版本。Windows 是正式支持平台；其他平台的安全凭据存储尚不可用。

## 私下报告

请将漏洞说明发送至 **2768651338@qq.com**，标题包含 `[aigit security]`。不要在公开 issue、PR、讨论区或 AI 对话中披露未修复漏洞或真实凭据。

报告建议包含：受影响版本、复现步骤、影响、攻击前提、最小 PoC 与建议修复。请先删除 token、私人仓库内容和个人路径。维护者会尽力在 7 天内确认，并在验证、修复和发布完成前协调披露时间。

## 安全模型

- 前端仅获得 capability 中声明的桌面 API；CSP 禁止远程脚本、frame、object 和表单。
- Markdown 原始 HTML 不启用；外链只允许 HTTP(S)/mailto，并在系统应用中打开。
- 导出路径来自原生保存对话框，必须为绝对路径且扩展名与格式一致。
- 固定的 Git/`gh` 子进程通过参数数组执行，不使用 shell 字符串。
- API Key/PAT 在 Windows Credential Manager 中保存；配置仅包含 endpoint、模型和凭据状态。
- 仓库内容仍是不可信输入：diff、commit message、Markdown、remote、分支名和 AI 响应都必须保持数据边界。

## 用户责任

只安装可信签名/校验来源的构建；保护系统账户与 Credential Manager；审查自定义 AI/embedding endpoint；在推送、PR 创建、行内评论、reset/丢弃等操作前确认目标。`gh` 的权限由用户的 `gh auth` 配置决定。

## 自动升级

当前 updater 没有 endpoint/公钥且不生成更新 artifact，应用不会自动更新。未来启用时必须使用 HTTPS、签名 manifest/artifact、密钥隔离和可回滚发布流程。
