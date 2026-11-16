# Orbis Web Lite 0.1.0-alpha.10

首次 GitHub 公开预发布，汇总此前网页实验版成果。[在线入口](https://consult.azhi-xinxin.cn/orbis-web/) · [完整 FAQ](FAQ.zh-CN.md) · [部署说明](../SELF-HOSTING.md)

## 主要能力

- 单一 AI、多窗口；本地记忆三档、跨窗存查、冻结注入、本地 BGE 语义召回。
- AI 自写摘要压缩、压缩前原文分支、最近一次回退；修复压缩后首条历史为 assistant 的续聊请求问题。
- Messages / Chat Completions、完整工具续轮、停止、逐请求用量、可选 Streamable HTTP MCP。
- 人类思考链、引用/撤回、窗口提示词/世界书权限、四种气泡与明暗主题。
- DeepSeek 官方搜索、附件、ASR/TTS、保存语音条、需人类接听的 AI 来电。
- 独立通话页、可滚动/展开字幕、挂断总结与完整原文/音频；被拦截播放时恢复已有音频。
- 固定消息时间与时区、按需查时；人类只开关哨兵授权，AI 自主安排规则。alpha.10 的唤醒显示为默认折叠时间点，展开不改历史、不额外请求模型。
- 完整 ZIP / 加密备份、文字迁移导出、主屏幕入口和离线页面壳。

## 下载选择

- 普通使用：打开在线入口，不需要下载或 VPS。
- `Orbis-Web-Lite-0.1.0-alpha.10-static-root.zip`：解压内容托管到域名根路径 `/`。
- `Orbis-Web-Lite-0.1.0-alpha.10-static-orbis-web.zip`：解压内容托管到 `/orbis-web/`。
- `Orbis-Web-Lite-0.1.0-alpha.10-source.tar.gz`：对应源码；静态包内也含页脚可下载的 `source.tar.gz`。
- `SHA256SUMS.txt`：下载文件校验值。

不是 APK，不能直接安装；正式托管需 HTTPS、正确 MIME 和模型接口跨域。GitHub Pages 工作流为手动入口，先启用仓库 Pages 再运行，路径按仓库名构建。

## 验证与限制

类型检查、52项逻辑测试、生产构建通过；浏览器测试包括实际捆绑 ONNX 与合成模型/语音流程。iPhone 用户确认过通话界面、字幕、转写、语音条和识图；修复后真实播放、长期运行、各服务云缓存和不同机型未全部验收。

这是 alpha：没有关页服务器哨兵/推送、全双工电话、云端同步、Android 全量恢复或本地 stdio。轻量记忆只限当前窗口；Lite 世界书是整段背景，不是 Android 关键词条目库。既有 lint 风格与 Hook 依赖检查项未清零。

首次公开文档补齐手机/VPS/电脑开机、服务器负担、清理数据、备份迁移、缓存、哨兵、语音和 MCP 的常见问题。AGPL-3.0-only，保留 DeepSeek MIT、模型和 ONNX 原有声明。
