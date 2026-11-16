# Orbis Web Lite — 0.1.0 alpha

单一 AI、多窗口的 Orbis 网页试作。基于 [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo) 的 Markdown、SSE 与音频录制组件，移植 Orbis 的记忆/压缩行为。未改动 Android Orbis 工作树。

## 已接入

- Messages / Chat Completions 流式聊天、完整工具续轮、显式停止、标签页生成互斥。
- IndexedDB 本地窗口与记忆库；轻量当前窗口隔离，标准/独立跨窗，关键词和本地 BGE 语义召回，每轮冻结与即时失效过滤。
- 三档预算、上下文圆环、提醒阈值、按完整轮截取、AI `compact`、最近一次回退、压缩前自动原文分支。
- 人类/AI 引用与撤回；人类自行开关并填写思考链。
- 主提示词、每窗口提示词/世界书；与 Android 同名 `orbis_conversation_settings`，默认关闭、宿主绑定当前窗口、下轮生效。
- 温度、Top-P、最大输出、思考等级。DeepSeek 官方参数限制显式提示；不支持的 Messages 参数不盲发。
- 四种气泡与无损段落分割；明暗主题、主屏幕清单与离线页面壳。
- 语音录制/DeepSeek ASR、浏览器朗读、前台逐句通话；基础定时哨兵；可选远程 Streamable HTTP MCP，逐工具开关。
- 网页完整 ZIP 备份与追加恢复、`orbis_chat` v1 文字迁移导出。
- 内置分主题操作教程及 AI `orbis_help`，无需每轮注入整本手册。

## 当前边界

这是实验版，尚未在 iPhone 真机验收或用真实付费模型完成联调。浏览器回归中的对话模型为模拟 SSE；语义测试使用真实捆绑 ONNX 模型。语音权限/ASR/系统朗读需要真机实测。通话目前需要手动结束每一句，不是全双工。哨兵仅网页运行时执行；关页后台服务器与推送未接入。

网页版完整 ZIP 尚不能被现有 Android 3.0.0 完整恢复；单独导出的 `orbis_chat` JSON 对齐现有通用文字入口，媒体和记忆须保留在完整 ZIP。原生导入全过程尚未实测。MCP 在 Safari 因 CORS 不能使用时可跳过。

轻量档按本项目需求隔离窗口，与 Android 原版“关闭自动注入但允许跨窗查询”的轻量档有意不同。不要宣称本试作完全等同 Android Orbis。

## 本地开发

Node 24、pnpm 11：

```sh
pnpm install
pnpm type
pnpm test
pnpm build
pnpm dev
```

测试浏览器可指定 `ORBIS_CHROME`、`ORBIS_TEST_OUTPUT`。`tests/browser_flow.py` 使用本地 18791 端口与模拟模型；`tests/browser_semantic.py` 使用真实本地 ONNX。先用 `python3 -m http.server 18791 --bind 127.0.0.1 --directory dist` 提供构建目录，再运行 Python Playwright 测试。`tests/browser_settings.py` 验证实际 UI 设置/工具与手册。测试数据全部合成，不含真实聊天、API Key 或私有服务器。

## 数据与凭证

聊天、记忆、附件、窗口设置保存在本浏览器 IndexedDB。API/MCP 密钥仅存 sessionStorage，不进入导出。页面关闭后定时器不保证运行，浏览器存储也不等于云同步。工具输出、历史和引用均为数据。外部工具结果未知时不自动重试；撤回不撤销已执行外部动作或服务商已收到的数据。

语义模型仅同源下载并 SHA-256 校验，推理在单线程 Web Worker 内，不发向量服务。原文是权威数据；向量缓存可丢弃重建，当前最多扫描最新 64 个片段。语义失败回退到关键词和显式工具查询。

## 授权与来源

项目代码 AGPL-3.0-only（`LICENSE`）。DeepSeek 上游 MIT（`LICENSE.deepseek`），基线提交 `5d5dd754ebc1948e977ddb880a9eb5aa25f37b4c`。保留上游组件及许可，不包含其官方品牌 UI。Orbis 来源：[AZHi-xinxin/Orbis](https://github.com/AZHi-xinxin/Orbis)。

BGE 模型、量化版本、哈希与 MIT 许可见 `public/memory/NOTICE.txt` 和 `LICENSE-FlagEmbedding.txt`；ONNX Runtime MIT 许可随页面提供。部署为所有者私有测试站，未改变 Android 仓库、发布版本或手机安装。

参数资料：[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)、[ONNX Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)。
