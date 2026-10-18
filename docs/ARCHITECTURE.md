# 架构

QQ → SnowLuma / OneBot → `onebot.ts` → `companion.ts` → Codex App Server。

- `codex.ts`：标准输入输出 RPC、订阅登录、模型及回复事件；项目独立 CODEX_HOME。
- `store.ts`：私人配置、角色、记忆、日记和 JSONL；`usage.ts`：Token 统计和额度保护。
- `tasks.ts`、`scheduler.ts`、`daily.ts`：任务池、设备/网页调度、主动和每日任务。
- `web-browser.ts`、`social-cli.ts`：专用浏览器与可选平台 CLI；`phone.ts`、`capabilities.ts`：ADB 与 phone-mcp 适配。
- `media.ts`、`scripts/media-worker.py`：本地语音和视频处理；`integrations.ts`：账号服务适配。
- `server.ts`：本机管理 API；`public/`：原生 JavaScript 管理页面。

聊天、网页与设备各有执行通道；多个任务共享网页/设备时排队，避免同时操控同一屏幕。聊天不必等待整个活动结束。只有实际返回的工具结果可作为执行成功依据。
