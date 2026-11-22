# dsh-plugin-smooth-stream

简体中文 | [English](README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-plugin-smooth-stream)](https://www.npmjs.com/package/dsh-plugin-smooth-stream)
[![CI](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.2.3--alpha.2-4b8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![deepseek1024](https://img.shields.io/badge/deepseek1024-%E5%B7%B2%E6%94%B6%E5%BD%95-4b8dff)](https://deepseek1024.com/plugins/SpookySandwich/dsh-smooth-stream)
[![stars](https://img.shields.io/github/stars/SpookySandwich/dsh-plugin-smooth-stream?style=flat&label=stars)](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/stargazers)

把逐字抖动的流式输出，换成按段落分批、淡入呈现的阅读体验。流式期间平滑跟随滚动，思考块显示实时单行摘要。

**左：DSH 原生渲染 · 右：Smooth Stream** —— 同一个问题，同时开始：

![对比演示](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/demo.gif)

## 安装

```bash
dsh plugin --profile web add dsh-plugin-smooth-stream
```

打开任意会话即可生效。设置入口：设置面板 → **Smooth Stream**。

## 它改变了什么

- **按段落呈现** — 回复不再一个字一个字地蹦，而是攒满一段，整段淡入。断句时自动避开没写完的代码块和表格，Markdown 不会渲染到一半。
- **平滑滚动** — 流式输出时页面匀速滑向底部，长回复也不会猛地一跳；往上滚就交还给你，滚回底部自动继续跟随。
- **思考摘要** — 模型思考时，折叠行里实时滚动最新一句，两端渐隐过渡；回合结束时下划线缓缓收起，示意"想完了"。
- **Markdown 与公式** — 正文走 DSH 自带的渲染器：代码高亮、复制按钮、表格、KaTeX 公式都和原生一模一样。

## 设置

设置面板中的 **Smooth Stream** 分区，改动即时生效并持久保存：

| 设置项 | 默认 | 说明 |
|---|---|---|
| 启用 Smooth Stream | 开 | 关闭后即时恢复 DSH 内置渲染，方便对比 |
| 入场动画 | 淡入 | 淡入 / 上升 / 浮现 / 拂过 / 聚焦 / 映亮 / 晕开 / 洇染 |
| 动画时长 | 520 ms | 入场动画时长（120–1200 ms） |
| 分批大小 | 500 字符 | 攒多少文字呈现一批；越小越"实时"，越大越安静 |
| 平滑滚动跟随 | 开 | 流式期间的平滑滚动跟随 |

带实时预览，可一键恢复默认。设置界面跟随 DSH 的显示语言。

## 动画风格

八种入场动画，默认节奏各自按风格调校；下面全部用同一段回复录制，便于直接对比。

| 淡入 Fade | 上升 Rise |
|---|---|
| ![fade](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/fade.gif) | ![rise](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/rise.gif) |
| **浮现 Dissolve** | **拂过 Wipe** |
| ![dissolve](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/dissolve.gif) | ![wipe](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/wipe.gif) |
| **聚焦 Focus** | **映亮 Glow** |
| ![focus](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/focus.gif) | ![glow](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/glow.gif) |
| **晕开 Iris** | **洇染 Soak** |
| ![iris](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/iris.gif) | ![soak](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/soak.gif) |

## 兼容性

待发布：新增对官方 DSH `0.2.3-alpha.2` 的支持（该版本要求使用 Node.js `^24.22.3 || >=26.13.1`）。

版本 `1.6.6`：适配官方 dsh `0.2.3-alpha.1`（同时保留已有兼容范围）。修复 `1.6.4` 与 `1.6.5` 在默认设置下于 `0.2.2-rc.5` 和 `0.2.3-alpha.1` 上流式平滑滚动跟随会脱离底部的问题：不再修改宿主对话滚动容器的 `scroll-behavior`，改由 `useGrowthGlide` 在流式输出期间平滑展开每批新增内容的高度，使宿主原生跟随始终贴合底部；在 `resolveSmoothFilePath` 中对齐 `0.2.3-alpha.1` 的会话目录解析回退顺序（依次读取实时 `workingDirectory` 投影、会话列表投影与初始 `cwd`），确保切换工作树后文件点击与右键菜单指向正确路径。（注：npm 上已发布的 `@deepseek-ai/dsh@0.2.3-alpha.1` 因上游尚未重新发布配套的 `@deepseek-ai/cordis-plugin-loader` 与 `@deepseek-ai/cordis-plugin-include` 而无法直接启动，需待 DeepSeek 重新发布这两个依赖包或使用源码标签构建。）

版本 `1.6.4` / `1.6.5`：显式支持官方 dsh `0.2.2-rc.4` 与 `0.2.2-rc.5`，保留已有兼容范围。已在 rc.4 Web 宿主上通过本地模拟服务、使用宿主的 DeepSeek 适配器验证流式输出后的拒绝：部分正文与思考会被清除，轮询、动画与滚动跟随停止；重载、重新连接与重启后均不会重新显示被拒绝的内容，后续回复仍正常流式呈现。rc.5 仅调整宿主选择网页搜索服务的方式；已在 rc.5 Web 宿主上验证：流式回复与历史记录在思考与正文分席中各只显示一次，思考与图片子插槽、引用、文件链接与思考翻译在重启后仍正常工作；含 `web_search` 结果的回合由宿主保留搜索卡片，Smooth Stream 只渲染思考与正文。

版本 `1.6.2`：适配官方 dsh `0.2.2-rc.3`（同时保留 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.5` 与 `0.2.2-rc.1` 兼容）。验证导入会话历史（含思考过程、网页结果、图片、缺失字节的附件卡片与错误中断回合）在首次打开与继续对话时的渲染与滚动跟随表现。

版本 `1.6.1`：恢复 Smooth Stream 接管助手消息节点时的 `conversation.chat.reasoning.body` 与 `conversation.chat.message.images` 宿主子插槽，恢复思考过程翻译工具栏与原生图片画廊；首行摘要完成前即可展开思考。

版本 `1.6.0`：适配官方 dsh `0.2.2-rc.1`（同时保留 `0.2.0-rc.2`、`0.2.1-rc.2` 与 `0.2.1-rc.5` 兼容）。在宿主助手节点入口绑定 `chatFileMentions.forClosing` 以保留回合末尾可操作的文件链接渲染；补全原生 Quote（引用）与右键上下文菜单交互：在已完成的助手回复及展开的思考块中保留文本交互标识，支持选中文字直接引用至输入框；文件链接右键菜单完整传递延迟路径解析与会话上下文。

版本 `1.5.0`：适配官方 dsh `0.2.1-rc.5`（同时保留 `0.2.0-rc.2` 与 `0.2.1-rc.2` 支持）。在思考摘要与历史视图中适配官方 rc.5 的思考签名格式：去除前导签名信封与尾部换行、流式期间隐藏未完成的信封前缀，并跳过纯签名块的显示，同时保持宿主底层消息块数据完整；修复 `prefers-reduced-motion`（减少动态效果）的 CSS 优先级覆盖，确保动画关闭与即时滚动在全部入场动画风格中均稳定生效。

版本 `1.4.0`：适配官方 dsh `0.2.1-rc.2`（同时保留 `0.2.0-rc.2` 支持）。按宿主 `groupPart`（`reasoning` / `response`）分席过滤助手消息块、中断标记与降级纯文本，避免思考块与正文重复显示；助手消息图片在 `0.2.1-rc.2` 下回退为普通 `<img>` 显示（无原生画廊/灯箱）。

版本 `1.3.0`：可在官方 dsh `0.2.0-rc.2` 上加载。渲染仍注册在 `conversation.chat.node` 与 `settings.section`。

版本 `1.2.0`：更新客户端渲染服务依赖与已验证的 DSH 版本范围；现有渲染行为通过新版宿主验证。

声明兼容范围为 `>=0.2.0-rc.2 <0.3.0-0 || 0.2.1-rc.2 || 0.2.1-rc.5 || 0.2.2-rc.1 || 0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5 || 0.2.3-alpha.1 || 0.2.3-alpha.2`；官方 dsh `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1`、`0.2.2-rc.3`、`0.2.2-rc.4`、`0.2.2-rc.5`、`0.2.3-alpha.1` 与 `0.2.3-alpha.2` 满足该范围。旧版 DSH 请保留上一插件版本。[验证记录](.github/reviews/dsh-0.2.2-rc.1.md)。

可从 [GitHub 最新 Release](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/releases/latest) 下载 `.tgz` 发布包，然后执行 `dsh plugin --profile desktop add <下载的发布包路径.tgz>`（将占位符替换为实际路径）。

当前兼容目标为 DSH `0.2.3-alpha.2`。运行 `npm ci`、`npm test` 和 `npm run check:package` 可验证构建及发布包。更新后请重启 DSH。


- 使用宿主的客户端服务、Markdown 和图片接口；自动化测试覆盖加载与组件渲染。
- 展开的思考正文与图片组通过宿主子插槽渲染，保留思考翻译控件及原生图片画廊。思考正文由插槽提供者控制，因此 Smooth Stream 的正文分批淡入仅保留在旧宿主的降级渲染中。首行摘要完成前即可展开思考；摘要文本尚未就绪时，行内仅显示标题与图标。摘要滚动、淡入及结束下划线仍然保留。
- 本插件接管对话视图的 assistant 消息渲染（`conversation.chat.node` 的 `assistant-step` 槽位），与其他同样接管该渲染的插件互斥——同装时只有一个生效。
- 遵循 `prefers-reduced-motion`：系统开启减少动态效果时，所有动画与平滑滚动自动关闭。
- 渲染出错时自动降级为纯文本显示，不影响会话其余部分。

## License

[MIT](LICENSE)
