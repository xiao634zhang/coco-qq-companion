# coco · Codex QQ 伙伴

运行在 Windows 的 QQ AI 伙伴，使用 Codex App Server 接入 ChatGPT 登录，提供本地管理页面。角色、记忆和工具权限由你管理。

## 功能

- QQ 管理员私聊、多轮会话、模型与思考强度切换；可配置群聊和 @ 唤醒。
- 可编辑角色、长期记忆、日记、主动聊天、每日任务与经历记录。
- 聊天、网页、安卓活动并行；可配置任务池上限，默认 10。网页和设备各自串行使用共享资源。
- 独立浏览器浏览与截图，小红书、知乎 CLI 可选接入。
- 安卓模拟器截图、点击、滑动、中文输入、应用启动、宏和短录屏抽帧；2048 游戏示例。
- QQ 发图、表情包；可选本地语音识别与 Kokoro 中文语音合成。
- QQ 空间工具与网易云只读适配器；依赖网关、登录状态和平台支持。
- 每日 Token 统计、CSV 导出、额度保护、日志、备份恢复。

网页样式与前端源码完整保留在 `public/`。第三方软件、登录数据、模型文件和个人聊天记录不随仓库发布。

## 快速开始

1. 安装 Windows、Node.js 24 和官方 Codex CLI；或先运行 `powershell -ExecutionPolicy Bypass -File scripts/setup-runtime.ps1` 下载项目内 Node。
2. 在项目目录运行 `npm ci`，再运行 `npm run check` 和 `npm test`。便携 Node 用户需将 `.runtime/node-v24*-win-x64` 加入当前终端 PATH。
3. 使用便携运行时双击 `start.cmd`；已安装系统 Node 的用户可运行 `npm start`，然后用 `data/console-token` 登录本机管理页 <http://127.0.0.1:3210/>。
4. 在管理页完成项目独立的 ChatGPT 登录，填写管理员 QQ，选择账号实际提供的模型。
5. 自行安装 SnowLuma、登录 QQ 小号，配置 OneBot HTTP/WebSocket 和访问令牌，再在管理页连接。

首次运行自动生成私人 `config.json`、`role.md` 和 `data/`。不要把它们提交到 Git。详细步骤和可选依赖见 [安装说明](docs/INSTALLATION.md)。

## QQ 指令

```text
/状态
/模型列表
/模型 <模型ID>
/思考强度 <档位>
/暂停
/继续
/主动 开
/主动 关
/重置会话
/任务 网页 搜索一个你感兴趣的话题
/任务 游戏 玩2048
```

重置会话保留长期记忆和日记。任务与设备能力需要先在管理页启用。响应速度受模型、网络和工具调用影响，适合回合制和慢节奏操作。

## 额度和数据

本项目不自带付费 API 后备通道。ChatGPT 订阅能否使用模型、实际额度和恢复窗口由账号服务决定。每日 Token 可以统计本项目运行调用；订阅额度百分比是账号层面的变化，其他会话也会影响，20% 项目窗口保护属于保守软保护，不是独立扣费账户或精确项目百分比。

后台与模拟器在本机运行，模型推理通过 Codex 服务进行；相关聊天和工具资料会发送给所选模型。关机或休眠会中断本机任务。登录会话保存在本机，详见 [安全与隐私](SECURITY.md)。

## 开发

```sh
npm ci
npm run check
npm test
npm run audit:public
```

[架构](docs/ARCHITECTURE.md) · [开发与发布](docs/DEVELOPMENT.md) · [贡献指南](CONTRIBUTING.md)

MIT 许可。陪伴设计参考 [AI Companion Kit](https://github.com/pinganbbOvO/ai-companion-kit)，复用部分 phone-mcp 源码并保留其许可。归属及未随附依赖见 [第三方说明](THIRD_PARTY_NOTICES.md)。
