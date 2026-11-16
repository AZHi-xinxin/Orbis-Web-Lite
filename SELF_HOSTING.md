# Orbis Web Lite 独立部署

公开入口：https://consult.azhi-xinxin.cn/orbis-web/

此版本是 Orbis Web Lite，仿官端外观名为“DeepSeek · 简约蓝”，不是 DeepSeek 官方客户端。配色与鲸鱼图形复用 Android Orbis 中已有资源。主题不绑定模型或改记忆；默认简约蓝、跟随系统，旧数据无新字段时维持 Orbis 和旧日夜选择。

## 构建

Node 24 / pnpm 11，运行 `pnpm install --frozen-lockfile`、`pnpm type`、`pnpm test`、`ORBIS_WEB_BASE=/orbis-web/ pnpm build`。根目录部署可用默认 `/`。部署 `dist/` 为纯静态 HTTPS 文件，模块 `.mjs` 必须用 `application/javascript`，WASM 用 `application/wasm`。

应用、字体、ONNX 模型与 WASM 均同站提供。模型接口按用户配置直连；没有自动代理 API Key，没有服务器保存聊天。聊天仍是浏览器 IndexedDB，Key 仅在标签页 sessionStorage。MCP 与模型接口需支持跨域；无需 ChatGPT 登录。

Service Worker 仅控制本应用子目录。离线只可打开已缓存页面/已有记录；联网生成仍需模型接口。切换域名没有自动数据迁移：从旧站“导入与导出”导出网页完整备份，在新站导入，Key 重新填写。Android 全量导入和关页后台哨兵仍待实现。

## 许可证与来源

AGPL-3.0-only，见 LICENSE。原 DeepSeek chat-demo MIT 条款在 LICENSE.deepseek；本地记忆模型的条款在 public/memory/。鲸鱼资源来自 Android Orbis `app/src/main/assets/icons/deepseek-color.svg`，简约蓝颜色来自 `OrbisPalette.DeepSeekLight/DeepSeekDark`。部署时在 `dist/source.tar.gz` 放此版本对应源码（不含凭证、运行数据或 node_modules），页脚提供下载。

## 验证

浏览器测试可设置 `ORBIS_TEST_URL` 为子目录地址；`tests/browser_appearance.py` 验证日夜/跟随系统、旧设置保留、窗口搜索、四种屏宽、离线页面及子目录资源。flow/settings/semantic 覆盖聊天、工具、记忆与实际 ONNX 运行。浏览器测试不能替代 iPhone 真机或每位访客的移动网络验收。
