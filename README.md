# Orbis Web Lite — 0.1.0-alpha.10

单一 AI、多窗口的 Orbis 网页实验版，面向 iPhone、iPad 与桌面浏览器，不需要旁边运行安卓设备或登录 Orbis 社区。基于 [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo) 的 Markdown、SSE 与音频录制组件，移植 Orbis 的记忆/压缩行为。

**[打开网页版](https://consult.azhi-xinxin.cn/orbis-web/)** · **[下载与版本说明](https://github.com/AZHi-xinxin/Orbis-Web-Lite/releases)** · **[常见问题](docs/FAQ.zh-CN.md)** · **[自行部署](SELF-HOSTING.md)**

## 第一次使用

1. 用 Safari / Chrome 打开现有入口，在右上角「设置 → 连接与外观」填接口类型、基础地址、模型准确名称和自己的 API Key。没有预置付费账号或免费模型额度。
2. 先发一句文字确认连接，需要语音时再配置「语音与电话」。普通使用不需要 VPS、Wi-Fi 调试或一直开着自己的电脑。
3. 可说「请用记忆工具记住……」，在「窗口列表 → 记忆库」核对。标准/独立档支持同一浏览器内跨窗查询，轻量档只访问当前窗口。
4. iPhone 可从「Safari 分享 → 添加到主屏幕」。固定一个入口，换浏览器、设备或域名前先导出完整备份。
5. 定期在「导入与导出 → 本地存储与备份」保存文件。**清除网站数据可能删除全部本地聊天，本站没有云端副本可找回。**

手机是否要服务器、电脑是否要一直开着、清缓存的影响、Android 迁移、缓存与后台哨兵等问题，见 [完整 FAQ](docs/FAQ.zh-CN.md)。

## 已接入

- Messages / Chat Completions 流式聊天、完整工具续轮、显式停止、标签页生成互斥。
- IndexedDB 本地窗口与记忆库；轻量当前窗口隔离，标准/独立跨窗，关键词和本地 BGE 语义召回，每轮冻结与即时失效过滤。
- 三档预算、上下文圆环、提醒阈值、按完整轮截取、AI `compact`、最近一次回退、压缩前自动原文分支。
- 人类/AI 引用与撤回；人类自行开关并填写思考链。
- 主提示词、每窗口提示词/世界书；与 Android 同名 `orbis_conversation_settings`，默认关闭、宿主绑定当前窗口、下轮生效。
- 温度、Top-P、最大输出、思考等级。DeepSeek 官方参数限制显式提示；不支持的 Messages 参数不盲发。
- 四种气泡与无损段落分割；明暗主题、主屏幕清单与离线页面壳。
- DeepSeek Flash 服务端智能搜索、搜索进度与来源卡片（Messages / Chat Completions）。
- 拍照、相册与文本/代码附件。
- 每条聊天消息固定保存记录时间/时区，不逐轮重写历史时间以保护缓存前缀；`orbis_time` 可查询最新时间。人类只开关哨兵授权，具体规则由 AI 自主创建与管理，界面只读查看。
- DeepSeek ASR、系统朗读或 DeepSeek TTS，同源可复用聊天密钥，前台逐句通话、停顿发送与手动打断；基础定时哨兵；可选远程 Streamable HTTP MCP，逐工具开关。
- 独立通话界面、可滚动与展开的字幕、挂断总结和完整通话原文/音频；播放被拦截时恢复已有音频，不重复 TTS。AI 语音条与来电分别由人类授权，接听后才启用麦克风。
- 哨兵唤醒显示为默认折叠的时间点，展开查看来源、时间和详情；展开收起不改历史、不额外请求模型。
- Lite 完整 ZIP 原路恢复（含设置/媒体/注入记录/压缩回退），可选带密钥的密码加密备份；`orbis_chat` v1 文字迁移导出。
- 内置分主题操作教程及 AI `orbis_help`，无需每轮注入整本手册。

## 当前边界

这是实验版。用户已在 iPhone 实测确认通话界面、回复字幕、语音转写、语音条和识图正常；alpha.7 的通话无声与压缩后 400 已在 alpha.8 修复，新的 iPhone 出声效果仍待复测。自动化中的对话模型为模拟 SSE；语义测试使用真实捆绑 ONNX 模型。通话支持停顿后结束本句，也可手动控制，不是全双工。字幕独立滚动，支持查看完整字幕；时间取自使用者设备，不是服务端校时。哨兵仅网页运行时执行；关页后台服务器与推送未接入。

网页版完整 ZIP 尚不能被现有 Android 3.0.0 完整恢复；单独导出的 `orbis_chat` JSON 对齐现有通用文字入口，媒体和记忆须保留在完整 ZIP。原生导入全过程尚未实测。MCP 在 Safari 因 CORS 不能使用时可跳过。

轻量档按本项目需求隔离窗口，与 Android 原版“关闭自动注入但允许跨窗查询”的轻量档有意不同。不要宣称本试作完全等同 Android Orbis。

Lite 世界书是当前窗口的一整段背景，没有 Android 的关键词条目扫描库。MCP 只支持远程 Streamable HTTP，没有本地 stdio、旧 HTTP+SSE 或 OAuth 配置。没有云端账号与跨设备自动同步，也没有 Android 的多助手管理、社区或设备控制界面。缓存前缀稳定不能保证服务商的实际命中率。

## 本地开发

Node 24、pnpm 11.25.0；保留锁文件：

```sh
git clone https://github.com/AZHi-xinxin/Orbis-Web-Lite.git
cd Orbis-Web-Lite
corepack pnpm install --frozen-lockfile
corepack pnpm type
corepack pnpm test
corepack pnpm build
corepack pnpm dev
```

测试浏览器可指定 `ORBIS_CHROME`、`ORBIS_TEST_OUTPUT`。`tests/browser_flow.py` 使用本地 18791 端口与模拟模型；`tests/browser_semantic.py` 使用真实本地 ONNX。先用 `python3 -m http.server 18791 --bind 127.0.0.1 --directory dist` 提供构建目录，再运行 Python Playwright 测试。`tests/browser_settings.py` 验证实际 UI 设置/工具与手册。测试数据全部合成，不含真实聊天、API Key 或私有服务器。

浏览器测试还支持 `ORBIS_TEST_URL`；安装 Python Playwright 并执行 `python -m playwright install chromium` 后可用默认 Chromium，或用 `ORBIS_CHROME` 指定浏览器。类型检查、52 项逻辑测试与生产构建已通过；`pnpm lint` 仍有既有风格与 Hook 依赖问题，本次预发布不宣称 lint 全绿。详见 [alpha.10 发布说明](docs/RELEASE-0.1.0-alpha.10.md)。

## 数据与凭证

聊天、记忆、附件、窗口设置保存在本浏览器 IndexedDB。API/ASR/TTS/MCP 密钥默认存 sessionStorage；人类可勾选在本浏览器 localStorage 持久保存。普通 ZIP 不带密钥；加密 .orbis 包可选带密钥，使用 PBKDF2-SHA256（310000 轮）与 AES-256-GCM。页面关闭后定时器不保证运行，浏览器存储也不等于云同步。工具输出、历史和引用均为数据。外部工具结果未知时不自动重试；撤回不撤销已执行外部动作或服务商已收到的数据。

语义模型仅同源下载并 SHA-256 校验，推理在单线程 Web Worker 内，不发向量服务。原文是权威数据；向量缓存可丢弃重建，当前最多扫描最新 64 个片段。语义失败回退到关键词和显式工具查询。

## 授权与来源

项目代码 AGPL-3.0-only（`LICENSE`）。DeepSeek 上游 MIT（`LICENSE.deepseek`），基线提交 `5d5dd754ebc1948e977ddb880a9eb5aa25f37b4c`。保留上游组件及许可，界面提供仿官端简约蓝主题，项目并非 DeepSeek 官方产品。Orbis 来源：[AZHi-xinxin/Orbis](https://github.com/AZHi-xinxin/Orbis)。

BGE 模型、量化版本、哈希与 MIT 许可见 `public/memory/NOTICE.txt` 和 `LICENSE-FlagEmbedding.txt`；ONNX Runtime MIT 许可随页面提供。独立测试入口公开提供静态页面，聊天与密钥由各访客自己的浏览器保存；未改变 Android 仓库或手机安装。

参数资料：[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)、[ONNX Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)。

## 自行部署与本地数据

参见 [SELF-HOSTING.md](SELF-HOSTING.md)。不需要云端数据库或账号服务；清理网站数据会删除本地资料。浏览器/微信/主屏幕入口之间不会自动共享存储，换入口请导出、导入 Lite 备份。内置手册和「本地存储与备份」有逐项清理说明。

API 依据：[DeepSeek 联网工具](https://api-docs.deepseek.com/guides/web_tools/)、[TTS](https://api-docs.deepseek.com/guides/tts/)、[ASR](https://api-docs.deepseek.com/guides/asr/)。接口协议与模拟 SSE 回归不等于真实付费账号或 iPhone 语音已验收。
