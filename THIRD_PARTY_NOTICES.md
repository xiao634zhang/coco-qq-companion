# 第三方组件

本项目原创的 Codex 桥接、管理页和任务编排以根目录 MIT 许可发布。

- `vendor/phone-mcp/src/phone-mcp.js`、`ncm.js` 与 package.json：来自 [pinganbbOvO/ai-companion-kit](https://github.com/pinganbbOvO/ai-companion-kit)，MIT，原许可保留在 `vendor/phone-mcp/LICENSE`。本项目通过适配层调用其中能力，未采用原 DSH 桥接。
- npm 依赖的版本见 package-lock.json；各包遵循自己的许可。
- `public/vendor/live2d-cubism4.js`：来自 [guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) 的 npm 0.4.0 发行包，MIT，Copyright (c) 2020 Guan；完整许可在同目录 `LIVE2D-DISPLAY-LICENSE.txt`。只保留浏览器渲染文件，不安装其无关文档发布工具。PixiJS 通过锁定的 npm 包提供。
- 本地检索使用 [Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) 的量化 ONNX 模型（Apache-2.0）；由 Transformers.js 下载到项目运行缓存，不随 Git 发布。
- Minecraft 接口使用 [Mineflayer](https://github.com/PrismarineJS/mineflayer) 和 [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)，均为 MIT。Minecraft 游戏、服务器、正版账号、Live2D 模型和 Cubism Core 运行库不随仓库分发，需按各自许可准备。
- 记忆与经历组织、交互和扩展的设计参考了 [Letta Code](https://github.com/letta-ai/letta-code)、[MaiBot](https://github.com/Mai-with-u/MaiBot)、[AstrBot](https://github.com/AstrBotDevs/AstrBot) 和 [AIRI](https://github.com/moeru-ai/airi) 的公开功能说明；本次这些功能为本项目独立实现，未复制其服务代码。
- SnowLuma、QQ、Codex CLI、浏览器、安卓模拟器、ADB、ADBKeyboard、Python 包和语音模型均为独立依赖，不包含在发行源码中。请从各自官方渠道获取并遵循其许可与平台条款。
- Kokoro 模型及其音色、Whisper 模型有独立许可；下载前查阅对应模型仓库。角色示例为本项目简短模板，不包含个人定制角色卡。

本项目与上述平台没有官方关联。
