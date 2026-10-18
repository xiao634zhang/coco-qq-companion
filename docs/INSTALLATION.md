# 安装

## 基础聊天

需要 Windows、Node.js 24、官方 Codex CLI、可登录的 ChatGPT 账号、QQ 小号和兼容 OneBot v11 的 SnowLuma。仓库不分发这些软件。

`scripts/setup-runtime.ps1` 将固定版本 Node 下载并校验至 `.runtime/`。安装 npm 依赖后运行 `start.cmd`。若使用系统 Node，可直接 `npm start`，管理页手动输入自动生成的 `data/console-token`。退出用 `stop.cmd`，健康检查 `health.cmd`，备份 `backup.cmd`；这些启动脚本使用项目便携 Node。

Codex 可从 PATH、VS Code 扩展自动发现，也可在配置填写 `codexPath`。先完成管理页中的官方 ChatGPT 登录，测试聊天，然后接 QQ。

SnowLuma 请从其官方项目发行页下载，解压到 `vendor/SnowLuma/`，确保包含 `launcher.bat` 后可用 `start-snowluma.cmd`。首次协议与密码由你设置。启用 HTTP 3000 和 WebSocket 3001，设置访问令牌；在本项目管理页填入相同地址与令牌、管理员 QQ 和小号 QQ。HTTP 单独令牌也支持配置。

## 可选能力

- 浏览器：运行 `npx playwright install chromium` 前设置 `PLAYWRIGHT_BROWSERS_PATH` 为项目 `.runtime/pw-browsers`。在管理页启用网页工具。
- 安卓：安装专用模拟器至项目同级 `android-emulator`，或设置 `COCO_EMULATOR_HOME`；ADB 放在 `.runtime/platform-tools`。打开 ADB 调试，管理页刷新并选择设备。中文输入需要自行安装 ADBKeyboard。App 需自行安装并登录，管理页逐项授权。
- 小红书/知乎：安装兼容的 `xhs` 与 `zhihu` CLI 及其 Python 依赖，首次登录由本人完成。`data/local-paths.json` 可填写 `xhs`、`zhihu` 两个 exe 的绝对路径及 `socialPython`。这份配置不提交；也可通过 `COCO_XHS_CLI`、`COCO_ZHIHU_CLI`、`COCO_SOCIAL_PYTHON` 设置。管理页检测需要可定位的 exe 路径，建议填写绝对路径。浏览器登录脚本需要 camoufox 及对应 CLI 的 Python 包，版本差异可能需调整适配器。
- 语音：运行 `setup-media.cmd`，再按 `scripts/setup-neural-voice.py` 提示下载 Kokoro 中文模型。依赖和模型放在 `.runtime/`。默认音色 `kokoro:zf_001`；效果和耗时取决于本机。Whisper 首次使用需下载模型。
- QQ 空间及群聊：在扩展页单独配置并测试网关支持。网易云当前只读，播放和一起听未完整开放。

克隆后默认没有任何登录会话。先验证基础聊天，再逐项开启扩展。更新前备份私人数据，停止服务，更新源码并 `npm ci`，检查通过后重启。备份与恢复可在管理页操作，恢复前保留当前数据备份。
