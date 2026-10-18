# 开发与发布

Node.js 24 + TypeScript，直接运行 TypeScript 源码，无构建打包步骤。`npm run check` 做类型检查；`npm test` 使用 Node 测试运行器，覆盖授权、去重、发送状态、记忆恢复、额度保护、调度边界、图片和语音适配。

仓库只跟踪公开白名单。本地角色和账号数据继续留在原目录，更新源码不会覆盖它们。不要使用 `git add -f` 绕过私有目录规则。

发布流程：修改源码和文档 → 运行检查与测试 → `git add` 明确路径 → `npm run audit:public` → 审阅 `git diff --cached` → 提交 → 推送。CI 执行同样的检查。设置 `git config core.hooksPath .githooks` 可在提交时强制审计。

新增配置项提供空值或安全默认值，通过示例说明填写方法；新增第三方源码保留许可并更新 THIRD_PARTY_NOTICES。不要把维护者的现场验证报告复制进仓库。
