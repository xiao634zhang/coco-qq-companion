# 第三方组件

本项目原创的 Codex 桥接、管理页和任务编排以根目录 MIT 许可发布。

- `vendor/phone-mcp/src/phone-mcp.js`、`ncm.js` 与 package.json：来自 [pinganbbOvO/ai-companion-kit](https://github.com/pinganbbOvO/ai-companion-kit)，MIT，原许可保留在 `vendor/phone-mcp/LICENSE`。本项目通过适配层调用其中能力，未采用原 DSH 桥接。
- npm 依赖的版本见 package-lock.json；各包遵循自己的许可。
- SnowLuma、QQ、Codex CLI、浏览器、安卓模拟器、ADB、ADBKeyboard、Python 包和语音模型均为独立依赖，不包含在发行源码中。请从各自官方渠道获取并遵循其许可与平台条款。
- Kokoro 模型及其音色、Whisper 模型有独立许可；下载前查阅对应模型仓库。角色示例为本项目简短模板，不包含个人定制角色卡。

本项目与上述平台没有官方关联。
