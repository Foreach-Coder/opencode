# OpenCode 1.18.18 会话 HTML 导出落地设计

- 对应需求：`ORIGIN-09`
- 跨版本 spec：根仓 `docs/origin-specs/09-session-html-export.md`
- 目标基线：OpenCode `v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 设计基线：`3163cbb65a1dd1833f70ac698b634f0c416afedf`
- 状态：功能实现及专项验收通过，准备正式发行；完整包类型检查仍有既有文件错误，详见验证记录。下方开发阶段记录保留当时的提交与产物状态。

## 现状与源码映射

`packages/app/src/utils/session-export.ts` 通过 SDK 同时取得 Session 和完整 messages，输出 `{ info, messages: [{ info, parts }] }`。会话菜单（V1/V2）、命令面板及上下文面板分别调用它。

保留 JSON 工具函数的默认行为。新增独立 HTML 生成模块和公共渲染资源，HTML 操作按需加载该模块；三个入口共用生成与下载逻辑，不修改会话运行、消息列表渲染或服务器协议。

## 技术方案

- 页面壳包含 CSP、视口声明、内嵌 CSS、`application/json` 数据块与渲染模块。
- 数据块存储原始 SessionExportData，另一个数据块存储格式版本、渲染器版本和本地化文案。嵌入 JSON 转义 `<` 及 Unicode 行分隔符，解析后完整恢复。
- 复用当前依赖 Marked 的独立 ESM 文本，以内嵌 data 模块供公共渲染脚本导入，不请求 CDN，不新增运行依赖。所有渲染器依赖随文件携带。
- Markdown 解析结果按明确标签/属性白名单重建 DOM；只允许 HTTP(S)/mailto 链接和安全栅格图片 data URL，不保留事件属性、样式、iframe、SVG 或危险协议。
- 原生 details/summary 展示工具与推理；代码复制使用 Clipboard API 并提供本地文件兼容回退。原始 JSON 下载从内嵌数据取得，不取 DOM 正文。
- `question` 工具独立渲染为默认可见的问题卡片，从 `state.input.questions` 读取题目和选项，从完成状态的 `state.metadata.answers` 读取逐题答案，支持多选和自由文本。只读高亮已选项，不提供可提交的输入控件；原始输入输出保留折叠入口。待回答、空答案、未保存答案和失败快照分别展示，异常问题结构回退通用工具展示。
- 助手消息按 `info.parentID` 归入对应用户提问的答复卡片，保留消息及 Part 顺序，包括中途错误；卡片仅显示第一条助手消息的身份和开始时间。归组跨渲染批次保持有效，不按时间或工具类型分割。缺少 `parentID` 的不完整记录独立展示，避免误合并；原始 JSON 不变。
- 用户 TextPart 的 `bluedcodeResponseAnnotations` 元数据渲染为引用原文和评论卡片，允许正文为空。`session-html-annotations.ts` 在导出时复用 core 的 `parseAnnotationDirectives`，将经过 Markdown 保护范围识别的 Unicode 偏移和对应用户批注锚点写入独立展示元数据；离线 JS 将有效指令渲染成“注释 N”链接。原始 JSON 及其指令文本不变，未知/重复/受保护示例按现有解析器规则保留。跨轮次用用户消息位置隔离锚点。
- CSS 使用参考的语义 token、鸿蒙字体及系统回退，消息区最大宽度约 1000px，768px 以下调整间距，宽内容仅块内滚动。
- 页面只渲染当前导出会话，不递归导出子会话；未知 Part 保留在原始 JSON 并以折叠数据说明呈现。
- 新增 i18n key；既有英文文案与 JSON command ID/slash 保持原样。
- `src/i18n/session-export.ts` 维护完整中英文功能词典，经 `context/language.tsx` 注册到统一的 typed i18n API；其他 locale 明确回退到英文，未声明新增功能已经完成全部语言翻译。原有全语言主词典和 parity 门禁保持原样。
- `session-html-download.ts` 只在 HTML 操作时加载，以 Vite `?raw` 携带已有 Marked ESM、`session-html/runtime.js` 与 `session-html/style.css`。数据生成在独立纯函数 `session-html.ts`；重建 DOM、折叠过程、图片限制和代码复制在 runtime 中。
- V1/V2 菜单、命令面板（`/export-html`）及上下文面板共用 `saveSessionExport`；进行中禁用所属入口，完成或失败后恢复。

## 实施与验证

1. 运行既有生产会话切换基准并保留原始结果。
2. 先写 JSON 往返、文件名与页面安全行为测试，确认缺失功能导致失败。
3. 实现 HTML 壳、渲染器、样式及各导出入口。
4. 单元测试、真实 Chromium 离线单文件测试、桌面/手机截图检查、类型检查和生产构建。
5. 同条件重跑生产基准，运行当前版本品牌兼容审计，记录结果。

用户确认本期不导出子任务的子会话过程，`task` 继续只展示主会话记录中的输入和返回结果。

## BluedCode 构建兼容性

- Desktop 依赖图：新增 app 内按需加载的导出模块，使用已有 Marked 依赖；无服务端、CLI 或 Node 运行依赖。
- 批注展示修正：导出生成模块复用已有 core 批注解析器及其现有浏览器兼容依赖，只在 HTML 导出时使用；不将 app/Core 依赖图嵌入离线 HTML，不新增运行依赖或修改品牌目标节点。
- 品牌规则目标：会话菜单所在 `message-timeline.tsx` 是受控目标，新增菜单使其指纹变化。最终只更新 `version/1.18.18/baseline.json` 中该文件的指纹，并更新子仓资源摘要中的对应配置文件摘要；英文/中文主词典最终无内容变化。
- 用户可见产品名：从已有 Product Profile 取得，不硬编码新品牌。
- CLI 入口剔除、更新禁用、Deep Link、数据隔离：不改变。
- 版本适配器/专用钩子/通用框架：仅更新当前精确版本的配置指纹，不修改规则、专用钩子或通用构建代码。
- 品牌兼容审计：`bun run build.ts --channel dev --audit-only` 通过，输出位于 `.xcode/bluedcode/workspaces/dev-00b2e926a3fd9c1c/stage/desktop/out`。
- 构建验收：Web 生产构建及 Desktop 审计构建通过。用户随后要求测试包，已使用 `bun run build.ts --channel dev` 生成 Windows x64 ZIP，并通过从解压目录启动真实 Desktop 的运行验收；没有生成 prod 发行包。

## 验证记录

2026-09-10，在 Windows x64 本地工作区执行：

| 检查 | 结果 |
| --- | --- |
| app `bun run test:unit` | 791 项通过，0 失败；包含 JSON 往返、文件扩展名及 i18n parity |
| app `bun run test:browser` | 43 项通过，0 失败 |
| `bunx playwright test --config e2e/export/playwright.config.ts` | 3 项通过；真实 Chromium `file://` 离线阅读、Markdown、图片、过程折叠、复制、JSON 下载、XSS 和 160 条消息的小屏溢出检查 |
| `bunx playwright test --config e2e/export/app.playwright.config.ts` | 3 项通过；生产构建中的 V1/V2 会话菜单、命令面板、上下文入口、完整数据导出、JSON 回归及中文功能词典 |
| 当前版本 `adapter.test.ts` | 5 项通过；受控目标接受当前源文件且品牌转换正常 |
| Web 生产构建、BluedCode audit-only | 通过 |
| app `bun typecheck` | 未通过：Windows checkout 将 `src/custom-elements.d.ts` 符号链接 materialize 为路径文本。验证时临时使用链接目标内容，检查后逐字节恢复；随后仍在未修改的文件中报告 27 项错误，新增导出模块及改动入口没有报错 |
| `git diff --check` | 通过 |

完整类型错误位于 prompt-input 测试、response-annotation fixtures、provider 设置、settings context 和 desktop-menu 等未修改文件；原始日志 `.xcode/html-export-typecheck.log`。没有通过降低类型检查严格度或修改无关代码使其变绿。

生产会话切换基准在修改前后串行运行，均使用 `SESSION_TAB_SWITCH_RUNS=1`、端口 4467 和当前基准套件生产构建。下表为 `stableObservedMs`：

| Review 面板 | 切换类型 | 修改前（ms） | 修改后（ms） |
| --- | --- | ---: | ---: |
| 关闭 | 冷切换 | 42.9 | 43.3 |
| 关闭 | 热切换 | 32.2 | 32.2 |
| 打开 | 冷切换 | 45.4 | 47.1 |
| 打开 | 热切换 | 32.1 | 45.3 |

前后均完成场景和指标采集，错误目标、空白和未知样本均为 0。单轮结果存在帧间调度波动，不据此作统计意义的性能无退化声明。原始结果保留在 `.xcode/html-export-before.log` 和 `.xcode/html-export-after.log`。

桌面 1280px 与手机 390px 截图均人工检查，无页面横向溢出；示例为合成会话，保存在 `.xcode/session-html-export-preview.html`，不是用户真实会话。完整测试日志保存在 `.xcode/html-export-*.log`。

实现参考：[Marked 安全说明](https://marked.js.org/)、[MDN 内容安全策略](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/CSP)、[Playwright 测试实践](https://playwright.dev/docs/best-practices)。中英文文案沿用当前产品词典的导出、附件、复制等术语；其他语言使用显式英文回退，不标记为已翻译。

未执行 commit/push/tag/Release。没有完整实现提交，因此不向 `ORIGIN-09` 版本实现矩阵登记工作区 HEAD。

## 开发测试包

用户授权后于 2026-09-10 生成 `BluedCode-Dev-1.18.18-dev-3163cbb65a-windows-x64.zip`（159.4 MiB），包含当前未提交的 HTML 导出改动。开发包版本中的 commit 是构建基线，不代表这些改动已经提交。

- 产物目录：`.xcode/bluedcode/workspaces/dev-00b2e926a3fd9c1c/artifacts/a2f0c6ca762d42ec72ef5031eaecf5455d1e08694d1d4f19866ce78fd3e7584a/`
- SHA-256：`6ab758fcd52284e37b40f7894881bc831bdfa8495764b8fc893cd01ade9b843e`
- 构建退出码 0；ZIP 载荷审计通过；解压应用可启动、renderer 就绪且干净退出。
- 文件大小及 SHA-256 已与同目录 `release-manifest.json` 逐项核对。
- 构建日志：`.xcode/html-export-package.log`。

## 答复归组修正（2026-09-10）

用户测试发现，同一次答复中的多条底层 AssistantMessage 被逐条渲染为独立卡片。修正为按 `parentID` 复用同一个助手卡片，原始消息数据不变，渲染器版本升为 2。仍以原始消息每 40 条分批追加内容，跨批次的同一答复不会重新建卡；不同 parent、缺少 parent 的记录不会误合并。桌面和手机示例页已重新生成。

- 先运行新增回归测试：一轮答复预期 2 张卡片却得到 4 张，跨批次/交错轮次预期 4 张却得到 46 张，均按预期复现失败。
- 修正后离线 Chromium 测试 6 项通过，覆盖归组、开始时间、展开推理、跨批次顺序、中途错误、不同轮次隔离、缺少关联字段的记录、JSON 下载完整性及既有安全/小屏行为。
- 导出相关单元测试 8 项通过；V1/V2 应用内导出与中文词典集成测试 3 项通过。集成测试运行时显式设置 `PLAYWRIGHT_PORT=4468`、`PLAYWRIGHT_SERVER_PORT=4468`；首次遗漏前者导致模拟接口拦截页面请求返回空 JSON，参数统一后重跑通过。
- 生产基准前后串行运行，`SESSION_TAB_SWITCH_RUNS=1`，端口 4467。Review 关闭时冷/热切换 `stableObservedMs` 为 54.3/28.7 → 47.3/29.4；打开时为 42.5/45.6 → 52.1/38.7。前后空白、错误目标和未知样本均为 0；单轮结果不用于统计性性能结论。
- 修正只改变离线导出模块，没有新增依赖、品牌名称或品牌目标节点，不需要更新适配器/钩子/通用框架。完整 dev 构建的品牌兼容审计、ZIP 审计及真实 Desktop 运行验收均通过，构建退出码 0。
- 本轮原始日志：`.xcode/html-grouping-{red,green,before,after,integration-verified,package}.log`。未提交、未推送或发布。

修正后的开发测试包替代上一节的旧测试包（相同版本名，独立产物目录）：

- 目录：`.xcode/bluedcode/workspaces/dev-00b2e926a3fd9c1c/artifacts/0eca39aa27a1275e56c8681ab0f4f0837c3ebbfe7c2d969924a92df8d9af4524/`
- 文件：`BluedCode-Dev-1.18.18-dev-3163cbb65a-windows-x64.zip`，167095235 字节（159.4 MiB）。
- SHA-256：`1532df7c91ea92831c62838e5c3e57dfbe76265fc931789c1e60a9a9637d620a`，已与清单和实际文件核对。
- `executableStarted`、`rendererReady`、`exitedCleanly` 和 ZIP 载荷审计均通过。
- 已经导出的旧 HTML 内嵌旧渲染器，需要用新包重新导出才能应用此修正。

## 批注展示修正（2026-09-10）

用户截图中的空白气泡对应正文为空、批注保存在 TextPart 元数据中的提交；助手的原始批注指令也未被导出器处理。本轮补充用户侧引用原文/评论卡片和助手侧批注跳转链接，沿用应用词典的“注释 N”表述，渲染器版本升为 3。只增加展示元数据，原始 JSON 保持不变。

- 新增浏览器回归先复现两项失败：用户评论不可见、批注链接数量为 0；修正后离线 Chromium 8 项测试通过，包含空正文批注、Emoji 偏移、同编号跨轮次隔离、代码/块引用/链接/HTML 块中的示例保留、恶意批注文本安全及 JSON 往返。
- 桌面与手机截图人工检查通过，示例页更新为批注场景。应用内导出集成测试 3 项通过，app 单元测试 791 项通过。
- 完整类型检查仍有原有 27 项错误，本次导出模块没有错误。检查临时替换 Windows materialized 符号链接内容后逐字节恢复，未修改该文件。
- 生产基准修改前后串行运行，Review 关闭时冷/热 `stableObservedMs` 为 51.0/32.1 → 48.5/34.3；打开时为 42.4/51.1 → 44.8/48.2。空白/错误目标/未知样本均为 0；单轮结果不作统计性性能结论。
- 完整 dev 构建退出码 0；品牌兼容、ZIP 载荷和真实 Desktop 启动验收通过。未修改版本规则或通用构建框架。阶段 renderer 中已核实卡片/引用处理及 `rendererVersion: 3`。
- 日志位于 `.xcode/html-annotations-{red,green,unit,typecheck,before,after,integration,package}.log`。

本轮测试包替代前述旧包，原有版本名保持不变：

- 目录：`.xcode/bluedcode/workspaces/dev-00b2e926a3fd9c1c/artifacts/2562cd1bace6ce1496dd4b8f98376236fbbaa21aacbd8a62f706605f365cbe70/`
- 文件：`BluedCode-Dev-1.18.18-dev-3163cbb65a-windows-x64.zip`，167096835 字节（159.4 MiB）。
- SHA-256：`71b61954ea9fe45f19e9372cd22307ce746504ca707829ca3cc26d7c6cae4e2a`，实际文件与清单的大小及摘要一致。
- ZIP 审计、启动、renderer 就绪和干净退出检查均通过。旧 HTML 需要重新导出。

没有执行 commit/push/tag/Release。

## 正式发行准备（2026-09-10）

用户随后授权提交、推送和正式 Release。本次范围为 HTML 导出、答复归组、批注展示及相关测试，不包含子会话过程导出。

- 发布前重跑：app 单元 791 项、浏览器 43 项、离线导出 8 项、应用导出集成 3 项均通过；当前版本 adapter 5 项、发行序号与构建配置 27 项通过。
- 集成配置同步默认页面/模拟接口端口，并使用终端报告，默认运行无需额外环境参数且不再生成未忽略的 HTML 报告；重跑 3 项通过。
- 正式构建使用干净子仓 HEAD 和发行号 `260910-01`，构建及运行审计通过后才创建 annotated tag。
- 本节不将开发包验收冒充正式产物验收；正式文件名、提交和 SHA-256 以 GitHub Release 及其 `release-manifest.json` 为准。

## 交互提问独立展示（2026-09-10）

用户在发布前要求问题无需展开工具 JSON 即可阅读。本轮为 `question` 增加默认可见的问题、选项和答案卡片，原始工具数据保留折叠区；渲染器版本升为 4。题目、选项描述、自由文本和失败信息均通过安全文本节点显示，页面不提供再次回答/提交行为。

- 新增两项浏览器回归先复现题目不可见和无独立卡片，再实现展示。离线测试共 10 项通过，覆盖多题、多选、自由文本、未回答/未记录区别、取消及异常结构回退。
- app 单元 791 项、浏览器 43 项和生产导出集成 3 项通过；桌面/手机截图检查通过。
- 串行生产基准（`before-serial` / `after`）Review 关闭冷/热稳定时间为 51.9/33.9 → 39.1/38.2 ms，打开时为 49.9/36.9 → 46.6/50.1 ms。空白/错误目标/未知样本均为 0，单轮数据不作统计性性能结论。
- 不增加 Desktop 依赖，不改品牌规则目标、CLI、更新、Deep Link 或数据隔离；正式候选包需基于本轮提交重新构建并通过审计。此前基于 `084ff1bb19` 的候选未创建 tag 或发布 Release。
- 原始日志位于 `.xcode/html-question-{red,green,unit,browser,integration,before-serial,after}.log`。
- 推送首次被 `.husky/pre-push` 的全仓类型检查阻止：Windows 将声明符号链接检出为路径文本；此前临时还原声明内容后 app 仍有 27 项既有错误。本轮没有修改或绕过钩子。
