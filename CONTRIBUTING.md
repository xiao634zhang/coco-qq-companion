# 贡献

使用 Node.js 24；运行 `npm ci`、`npm run check`、`npm test`。保持现有本地管理界面风格，工具扩展需明确权限、并发资源和失败处理。

测试使用虚构账号和临时目录，不依赖维护者登录状态。不要提交真实聊天、登录会话、截图或模型文件。新增依赖记录来源与许可；新功能更新安装文档及 CHANGELOG。

提交前 `git add` 明确文件，运行 `npm run audit:public` 并审阅 `git diff --cached`。文件白名单在 `.gitignore`；新增公共文件需明确加入。首次克隆可用 `git config core.hooksPath .githooks` 启用本地审计钩子。
