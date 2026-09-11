# OpenCode 1.18.18 Mermaid 图表渲染落地设计

- 对应需求：`ORIGIN-10`
- 跨版本 spec：根仓 `docs/origin-specs/10-mermaid-diagram-rendering.md`
- 目标基线：OpenCode `v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 状态：功能实现及专项验收通过，准备正式发行

## 当前结构

应用正文由 `packages/session-ui/src/components/markdown.tsx` 渲染。`markdown-stream.ts` 在流式阶段将围栏代码拆成 `mode: "code"` 块，`markdown.worker.ts` 使用共享 Marked 与 Shiki 生成安全 HTML 或增量代码 token；`markdown-cache.tsx` 使用 DOMPurify 清理普通 Markdown。已完成但从未流式展示的正文目前由 `completedProjection` 作为一个完整块解析，代码围栏最终仍会在 `decorate` 中包装为普通代码卡片。

HTML 导出由 `packages/app/src/utils/session-export.ts` 获取完整会话，`session-html-download.ts` 按需加载导出资源，`session-html.ts` 内嵌原始 JSON、展示元数据和公共运行脚本。离线 `runtime.js` 通过 Marked 解析后按白名单重建 DOM，目前不允许 SVG。导出页为固定浅色主题，CSP 禁止网络连接并只允许内嵌资源。

应用和导出当前都没有 Mermaid 依赖、图表识别、渲染缓存或 SVG 安全合同。

## 依赖与模块边界

- 根目录 catalog 固定引入 `mermaid@11.17.2`，`packages/session-ui` 声明该运行依赖。应用只能在首个已闭合 Mermaid 块或执行 Mermaid 导出时动态导入，普通会话启动路径不加载 Mermaid chunk。
- 新增 `packages/session-ui/src/components/markdown-mermaid.ts`，对外提供完成块识别、主题化渲染、SVG 清理、摘要计算和有限缓存。调用者只接收“安全 SVG”或结构化失败结果，不接触 Mermaid 全局状态。
- 新增 `packages/session-ui/src/components/markdown-mermaid-mounts.ts`，管理应用正文中的异步图表挂载、主题变化、过期请求和销毁。它与现有 `AnnotationReferenceMounts` 一样由 Markdown 根组件持有，不把 Mermaid 生命周期塞进通用 DOM diff 逻辑。
- `packages/session-ui` 导出预渲染接口供 `packages/app` 的 HTML 下载模块调用。应用正文与导出不得各自维护一套 Mermaid 初始化或 SVG 清理规则。
- Mermaid 配置固定包含 `startOnLoad: false`、`securityLevel: "strict"`、`htmlLabels: false`、`maxTextSize: 50_000` 和 `maxEdges: 500`。安全配置数组同时锁定安全级别、自动启动、HTML 标签、主题、自定义 CSS 及资源上限，阻止图表 frontmatter 或旧式指令覆盖站点设置。

## 应用正文数据流

1. `markdown-stream.ts` 延续现有围栏投影。只有信息字符串首词转为小写后等于 `mermaid` 的 `mode: "code"` 块进入图表分支。
2. 未闭合块继续调用现有 Shiki 增量高亮，用户在生成期间始终能看到完整进度。块标记为 `complete` 后停止代码高亮请求并启动 Mermaid 渲染。
3. 对于一次性加载的已完成正文，普通 Marked HTML 完成安全清理后，`decorate` 在包装代码块之前识别 `pre > code.language-mermaid`，提取 `textContent` 作为原文并交给相同挂载器。原文不从高亮后的标签或 SVG 反向恢复。
4. 图表生成期间保留原代码卡片。安全 SVG 就绪后，只有请求键仍与当前块、原文和主题一致时才替换代码卡片；迟到结果直接丢弃。
5. 图表容器使用独立 `data-component="markdown-mermaid"`，保存原文于组件状态而非可执行 HTML 属性。复制按钮调用现有剪贴板与反馈模式，复制与普通代码块相同的围栏内部代码文本，不包含围栏标记。
6. 主题键取当前 `useTheme().mode()`。主题变化时先查询“原文摘要 + 主题 + Mermaid 版本”的缓存；没有命中才重新生成。缓存采用 100 项 LRU 上限，淘汰时释放字符串和挂载引用。
7. 解析、限制、清理或挂载失败时保持普通代码卡片，在卡片上增加本地化失败状态；控制台只记录错误类别与摘要，不记录源码。

Mermaid 自身将 `render` 调用串行化。外层服务在同一队列中完成“应用可信主题配置 + 渲染”，不并发修改全局配置；只有明暗主题或固定导出主题发生变化时才重新应用站点配置，同主题的连续图表复用当前配置。

## 图表卡片

- 卡片沿用 Markdown 代码卡片的边框、圆角、正文间距和主题 token，不引入新的固定品牌颜色。
- SVG 位于独立画布中，最大宽度受正文约束，高度按 `viewBox` 自适应；宽图保持可读尺寸，不撑宽正文。
- 右上角提供“复制 Mermaid 原文”、缩小、复位和放大操作。缩放范围为 50% 至 200%，每次按 25% 调整；复位恢复 100% 并回到初始位置。放大后的图表可用鼠标或触控拖拽平移，交互只改变当前卡片的视图状态，不改写 SVG 或 Mermaid 原文。
- 操作按钮支持键盘并在触屏上保持可触达；成功图表不显示源码展开区。
- 安全 SVG 保留 Mermaid 生成的 `title`、`desc`、ARIA role 和标签。缺少可访问名称时，由容器提供本地化“Mermaid 图表”。
- 失败状态显示简短本地化说明、完整普通代码块和既有复制能力，不显示 Mermaid 内部异常文本。

新增文案必须进入共享 typed i18n：图表名称、复制原文和渲染失败；复制成功反馈复用现有“已复制”文案。英文源文案保持完整短语，中文使用“Mermaid 图表”“复制 Mermaid 原文”“图表渲染失败”。其他 locale 按现有明确英文回退规则处理，不宣称已经完成全语言翻译。

## SVG 安全处理

Mermaid 源码先在 `strict` 模式下生成 SVG，再使用 DOMPurify 的 SVG profile 清理。专用配置禁止 `script`、`foreignObject`、`iframe`、`object`、`embed`、`audio`、`video` 和交互链接，删除所有 `on*` 属性。`href`、`xlink:href`、填充、描边、marker、clip-path 和 mask 中的 URL 只允许当前 SVG 内的 `#fragment`；其他协议或绝对地址全部删除。

Mermaid 生成的局部样式只允许随已知 SVG 输出保留。清理阶段拒绝 `@import`、外部 `url(...)`、脚本协议和非本地资源引用。清理后使用 `DOMParser` 再次验证根元素必须是单个 SVG、不得出现禁用节点或外部 URL；任一步失败都不把 SVG 附加到 DOM。

不调用返回结果中的 `bindFunctions`，不启用 Mermaid click 指令、外部图标包、远程字体或可执行 HTML 标签。

## HTML 导出数据流

1. `saveSessionExport` 保持 JSON 分支同步行为；HTML 分支等待异步预渲染完成后再下载文件。现有各入口已经等待 `saveSessionExport`，继续用相同进行中与失败状态。
2. `session-html-download.ts` 从完整消息中提取所有走 Markdown 展示的闭合 Mermaid 围栏，按原文摘要去重，并通过共享服务以固定浅色主题串行生成安全 SVG。
3. `createSessionHtml` 保持 `session-data` 为未经改写的 `SessionExportData`。新增独立 `mermaid-snapshots` JSON 数据块，内容只包含格式版本、Mermaid 版本以及“摘要 -> 安全 SVG或失败状态”的派生记录。
4. 离线 `runtime.js` 在普通代码块装饰前识别 `language-mermaid`，以代码 `textContent` 计算同一摘要并查询快照。命中时构建图表卡片、原文复制按钮以及缩放和平移控制；未命中、摘要不符或 SVG 二次验证失败时保留代码块并显示失败状态。
5. 离线运行时只能解析已经清理的 SVG 快照，不包含 Mermaid 包，也不重新解释 Mermaid 语法。`session-data` 的 JSON 下载继续只读取原始数据块。
6. CSP 维持 `connect-src 'none'`。为显示安全内联 SVG 所需的标签与局部样式扩展离线 DOM 白名单，但不得放宽脚本、对象、frame、表单、远程图片或危险 URL 规则。

图表快照只增加实际图表的 SVG 和少量索引，不为不含 Mermaid 的 HTML 增加约 5.3 MiB 运行库或其 data URL 编码开销。导出文件依旧可以通过 `file://` 断网打开。

## 测试与验证

实施遵循 TDD。先记录当前生产会话切换基准，再添加会失败的行为测试：

- `packages/session-ui` 单元测试覆盖围栏语言识别、闭合前代码状态、闭合后单次渲染、迟到结果丢弃、主题缓存、复制原文、失败回退、LRU 淘汰和 SVG 安全清理。
- Markdown 流式测试覆盖围栏逐段到达、同一正文多图、普通代码与 Mermaid 交错、完成消息首次加载，以及重新挂载不重复生成。
- app Playwright 使用真实会话时间线验证流程图可见、源码按钮复制、主题切换、宽图只在卡片内滚动、错误语法回退、多个图表顺序和相邻正文完整。
- 导出 Playwright 通过 `file://` 打开真实单文件，验证 SVG 无需网络即可显示、原文复制、原始 JSON 逐值一致、无 Mermaid 运行库、错误与缺失快照回退、390px 页面无横向溢出。
- 安全用例包含标签 HTML、click 指令、前置配置覆盖、自定义 CSS、事件属性、`javascript:`、外部图片/字体/图标及 `url()`；通过网络监听断言应用渲染和导出打开都没有图表导致的外部请求。
- 视觉检查至少保存应用浅色、应用深色、导出桌面和导出 390px 四种截图，并用 Playwright 检查 SVG 与卡片边界，不能只验证 DOM 存在。

实现后运行 `packages/session-ui` 测试与类型检查、`packages/app` 相关单元/浏览器测试、应用与导出 Playwright、`git diff --check` 和生产构建。按 `packages/app/AGENTS.md` 在同一条件下重跑生产会话切换基准，比较普通无 Mermaid 会话以及含图表首次显示，不用单轮机器波动宣称统计性提升。

## BluedCode 构建兼容性

- Desktop 构建依赖图：`packages/session-ui` 新增完整 Mermaid 运行依赖，应用通过动态 import 形成按需 chunk；HTML 导出模块复用同一服务，不把运行库写入导出文件。
- 品牌规则目标与语义节点：预计修改 `packages/session-ui` Markdown 组件、样式、package 清单以及 `packages/app` 导出模块、运行时、样式和 i18n。实施时必须以当前版本 adapter 的受控目标和语义指纹审计为准，不能预先假定无需更新。
- 用户可见产品名称：不新增产品名。应用继续显示 `BluedCode`，HTML 页眉继续按 `ORIGIN-09` 显示 `CodeAgent`；Mermaid 源码中的任意品牌文本属于用户内容。
- CLI 入口剔除、更新禁用、Deep Link 和数据隔离：功能不改变这些行为，也不新增联网入口。
- 版本适配器与构建框架：若现有声明式指纹覆盖受影响文件，只更新 `v1.18.18` 配置及资源摘要；只有源码结构确实需要时才修改版本专用钩子，不扩展通用框架。
- 最终验收必须运行 `bun run build.ts --channel dev --audit-only`。审计通过后再生成用户要求的测试包或发布产物；审计失败时不得标记 `ORIGIN-10` 完成。

## 实施与验收记录（2026-09-11）

### TDD 记录

- 共享渲染器 RED：在 `packages/session-ui` 执行 `bun test src/components/markdown-mermaid.test.ts`，因模块不存在得到 `0 pass, 1 fail, 1 error`；在 `packages/app` 执行 `bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid.test.ts`，因导出不存在得到 `0 pass, 1 fail, 1 error`。最终分别为 `2 pass / 9 assertions` 与 `33 pass / 178 assertions`。
- 应用挂载与投影 RED：生命周期测试因挂载模块不存在得到 `0 pass, 1 fail, 1 error`；生产投影 seam 初次为 `2 pass, 2 fail`。审查修复先以 source fence、首次加载未闭合 fence、可访问标题和 cleanup 四类断言复现失败，最终 `markdown-stream.test.ts` 为 `26 pass / 36 assertions`，挂载与集成组合为 `14 pass / 42 assertions`。
- 导出 RED：`bun test src/utils/session-html-mermaid.test.ts` 初次因提取器不存在得到 `0 pass, 1 fail, 1 error`；HTML shell 首次得到 renderer version `11` 而非 `12`；focused Playwright 首次缺少导出 SVG。最终 focused 单元为 `2 pass / 16 assertions`，真实 `file://` 导出套件为 `20 passed`。
- 真实浏览器修复均先保留对应失败：生产高亮器缺少语言 class、设置页 fixture 缺失 `/pty/shells`、宽图被压缩以及 Chromium 实例化 keyframe 校验均有 focused RED，随后以最小修改复跑 GREEN。详细命令与输出记录在 `.superpowers/sdd/2026-09-10-mermaid-diagram-rendering/task-2-report.md` 至 `task-5-report.md`。
- Task 6 全量单元首轮执行 `bun run test:unit` 得到 `791 pass, 1 fail`；唯一失败是 3 个 Mermaid typed-i18n 键只存在于英中语言包。按本 spec 的英文回退合同为其余 60 个 locale 补齐明确英文回退后，同一命令复跑为 `792 pass, 0 fail, 3169 assertions`。这不宣称完成全语言翻译。
- 最终独立审查先以真实 production snapshot generator、Chromium 和离线 runtime 复现两个 RED：同 source 的两个闭合围栏加一个未闭合围栏错误显示为 `3 cards / 0 code`；重复图产生 `19` 个重复 DOM ID 与 `2` 个重复 keyframe。修复后复现为 `2 cards / 1 code`、重复 ID 与 keyframe 均为 `0`，focused Playwright `2 passed`，完整导出 Playwright `20 passed (9.5s)`。最终审查结论为 Pass，`0 Critical / 0 Important / 0 Minor` 遗留。

### Fresh 验证结果

| 范围              | 命令                                                                                                                                                                                                                                                                                  | 结果                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| session-ui        | `bun test src --only-failures`                                                                                                                                                                                                                                                        | `107 pass, 0 fail, 234 assertions`     |
| session-ui        | `bun typecheck`                                                                                                                                                                                                                                                                       | 退出码 `0`                             |
| app unit          | `bun run test:unit`                                                                                                                                                                                                                                                                   | `792 pass, 0 fail, 3169 assertions`    |
| app browser       | `bun run test:browser`                                                                                                                                                                                                                                                                | `92 pass, 0 fail`                      |
| app E2E types     | `bun run typecheck:e2e`                                                                                                                                                                                                                                                               | 退出码 `0`                             |
| app Playwright    | `bunx playwright test e2e/regression/session-timeline-mermaid.spec.ts`，端口 `4472`                                                                                                                                                                                                   | `3 passed (11.9s)`                     |
| export Playwright | `bunx playwright test --config e2e/export/playwright.config.ts`                                                                                                                                                                                                                       | `21 passed`                            |
| app build         | `bun run build`                                                                                                                                                                                                                                                                       | 退出码 `0`，`4430 modules transformed` |
| focused V2 性能   | `bunx playwright test --config e2e/performance/playwright.config.ts e2e/performance/timeline/session-tab-switch-benchmark.spec.ts --project=chromium --workers=1 -g "benchmarks v2 session tab switching with and without the review pane"`，`SESSION_TAB_SWITCH_RUNS=1`、端口 `4471` | `1 passed (28.4s)`                     |
| BluedCode 审计    | `bun run build.ts --channel dev --audit-only`                                                                                                                                                                                                                                         | 退出码 `0`                             |

| 工作区 | `git diff --check` / `git status --short` | 退出码均为 `0`，无 whitespace error |

原始输出位于 `.xcode/mermaid-session-ui-test.log`、`.xcode/mermaid-session-ui-typecheck.log`、`.xcode/mermaid-app-unit.log`、`.xcode/mermaid-app-browser.log`、`.xcode/mermaid-e2e-typecheck.log`、`.xcode/mermaid-app-e2e.log`、`.xcode/mermaid-export-e2e.log`、`.xcode/mermaid-app-build.log`、`.xcode/mermaid-after.log` 与 `.xcode/mermaid-brand-audit.log`。

### 构建、离线文件与视觉证据

- Vite 初始入口 `dist/assets/index-CBhCxoFO.js` 为 `2,912,913` 字节，只以 `import("./mermaid.core-s8dYbdA8.js")` 动态引用 Mermaid。初始入口不含 `mermaidAPI`、`getDiagramFromText` 或 `flowchart-v2`；独立 lazy core chunk 为 `683,080` 字节并包含这些运行库签名。检查明细在 `.xcode/mermaid-build-inspection.log`。
- fresh 导出夹具 `.xcode/mermaid-export-fixture.html` 为 `58,006` 字节，`session-data` 可逐值回读；不含 `mermaidAPI`、`getDiagramFromText`、`flowchart-v2`、`mermaid.initialize`、`@mermaid-js` 或 `mermaid.render`。真实 `file://` Playwright 同时验证独立快照 sidecar、精确复制、失败回退和零外部请求。
- 最终视觉证据为 `.xcode/mermaid-app-light.png`、`.xcode/mermaid-app-dark.png`、`.xcode/mermaid-export-desktop.png` 和 `.xcode/mermaid-export-mobile.png`。应用视口为 `1400px`，导出视口为 `1280px` 与 `390px`；宽图 SVG 为 `2393.14px`，仅卡片 canvas 产生横向滚动，页面无横向溢出，最小节点标签高度约 `20px`。

### 性能对比

修改前 focused V2 基线使用真实测试路径、`--project=chromium --workers=1` 和默认 5 轮采样；修改后按计划以同一 focused V2 场景执行 1 轮观察。两次的 `reviewDiffs` 均为 `72`，所有 blank、wrong-target 与 unknown 样本均为 `0`。

| 场景        | 基线 stableObservedMs min / median / max | 修改后单轮 stableObservedMs | 相对基线中位数 |
| ----------- | ---------------------------------------: | --------------------------: | -------------: |
| closed cold |                     `44.9 / 46.9 / 49.6` |                      `49.1` |      `+2.2 ms` |
| closed hot  |                     `25.5 / 29.9 / 33.0` |                      `26.8` |      `-3.1 ms` |
| open cold   |                     `43.8 / 45.6 / 47.4` |                      `55.1` |      `+9.5 ms` |
| open hot    |                     `31.4 / 37.0 / 44.2` |                      `39.2` |      `+2.2 ms` |

修改后只有一次样本，数值用于发现明显退化，不构成统计性提升或回归结论。普通无 Mermaid 时间线路径仍保持所有正确性计数为零；Mermaid 完整运行库不进入初始入口。

### 构建兼容性结论与已知限制

- `audit-only` 完成并生成审计 stage；现有 `v1.18.18` 声明式规则覆盖本次源码与依赖变化，没有 controlled-source fingerprint 失败，因此未修改 `xcode/build/bluedcode/version/1.18.18/baseline.json`、资源摘要、版本专用钩子或通用构建框架。
- SVG/CSS 正向合同针对 Mermaid `11.17.2` 的已观测输出；未来升级若新增安全标签、属性、CSS 或 keyframe，会先安全回退为源码，待独立审计后再放行。
- Happy DOM 对 Mermaid 内部 DOMPurify 的 SVG 首子节点处理存在已记录差异，测试使用局部 compatibility seam；真实应用和导出链路均由无 shim Chromium Playwright 覆盖。
- 其余 60 个 locale 暂使用明确英文回退；英文和简体中文提供完整本地化文案。
- 当前状态为“功能实现及专项验收通过，准备正式发行”。完整实现提交将在本轮提交后记录到本 spec 和根仓 `ORIGIN-10` 版本实现矩阵。
- `git status --short` 仍包含开始本需求前已存在的 ORIGIN-09 HTML 导出改动；Task 6 没有清理、覆盖或提交这些共享工作区内容。

## 参考

- [Mermaid API 使用方式](https://mermaid.js.org/config/usage.html)
- [Mermaid 配置 schema](https://mermaid.js.org/config/schema-docs/config.html)
- [Mermaid 完整包与 Tiny 包差异](https://github.com/mermaid-js/mermaid/blob/develop/packages/tiny/README.md)
- [Playwright 测试实践](https://playwright.dev/docs/best-practices)
