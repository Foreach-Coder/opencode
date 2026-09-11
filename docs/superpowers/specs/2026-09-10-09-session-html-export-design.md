# OpenCode 1.18.18 会话 HTML 导出落地设计

## 连续普通工具调用分组（2026-09-10）

同一次助手答复内连续出现至少 2 个普通工具调用时，离线页面将这些调用提升为一个默认折叠的分组，摘要显示“工具调用 · N 个”及聚合状态。展开分组后保留每个工具原有的独立折叠项，读者可继续按需查看输入、输出、附件和失败信息；只有 1 个普通工具时维持原展示。

分组状态按失败、执行中、待执行、全部完成的顺序汇总。分组以渲染后的同一助手答复为范围，能跨底层 AssistantMessage 和每 40 条一次的渲染批次继续；正文、推理、附件、交互提问、子智能体卡片、技能卡片、批注和消息错误会结束当前分组。不可见的 step 边界不改变页面上的连续关系。`question`、`task` 和 `skill` 始终使用各自的专用卡片，不进入普通工具分组。原始 JSON 不改写，渲染器版本升为 9。

BluedCode 构建兼容性：本轮只修改离线 HTML 的公共渲染器、样式和既有类型化文案，不改变 Desktop 依赖图、品牌规则目标、产品署名、CLI、更新、Deep Link 或数据隔离；不需要调整当前版本适配器、专用钩子或通用构建框架。最终以本轮专项测试、生产基准对比和当前版本品牌兼容审计结果为准。

- TDD 回归先在旧渲染器上因找不到“工具调用 · 3 个”失败；实现后完整离线 Chromium 测试 16 项通过，覆盖跨底层消息与 40 条渲染批次的连续分组、单工具保留、完成/执行中/失败汇总、提问/子智能体/正文边界、两层展开、原始 JSON 一致性和 390px 手机布局。
- app 单元测试 791 项、浏览器测试 43 项、真实 V1/V2 导出及中文词典集成 3 项、E2E 类型检查全部通过。桌面和手机截图已检查，合成预览 `.xcode/session-html-export-preview.html` 已更新。
- 生产会话切换基准在修改前后均以 `SESSION_TAB_SWITCH_RUNS=1`、端口 4467 串行运行。Review 关闭冷/热 `stableObservedMs` 为 49.3/25.3 → 41.2/28.3，打开冷/热为 42.2/36.0 → 40.1/37.4；两次运行的错误目标、空白和未知样本均为 0。单轮结果只用于发现明显退化，不作统计性性能结论。
- `bun run build.ts --channel dev --audit-only` 退出码 0，品牌兼容审计通过，输出位于 `.xcode/bluedcode/workspaces/dev-d38e09a786937dca/stage/desktop/out`。日志保存在 `.xcode/html-tool-group-*.log`；本轮未提交、推送、打包或发布。

### 推理记录卡片样式统一

用户确认后，将推理记录的折叠项增加独立语义类，并与普通工具分组共用 1px 边框、10px 圆角、14px 左右内边距及摘要字重；保持默认折叠，不合并多段推理或增加状态标签。初版只校验外框并保留通用 `.process-body`，展开后形成灰色圆角卡片嵌套。用户截图指出问题后，用 Playwright 实际展开并测量桌面与 390px 手机盒模型，确认没有溢出，根因是内容区仍带背景、圆角和水平内边距。修正后内容区使用透明背景、顶部分隔线和垂直内边距，并与摘要左右对齐，最大高度与滚动能力保留；渲染器版本升为 11。

- 外框样式回归先在旧实现上得到边框、圆角和内边距全为 0 的预期失败；展开布局回归随后在初版实现上准确得到灰色背景、10px 圆角和 14px 水平内边距的预期失败。最终实现同时验证外框一致性、内容区透明与分隔线、左右边界对齐和正文可见。
- 完整离线 Chromium 测试 16 项、相关单元测试 8 项、真实 V1/V2 应用导出及中文词典集成 3 项、E2E 类型检查全部通过。桌面和 390px 手机截图已检查，合成预览 `.xcode/session-html-export-preview.html` 已更新。
- 生产会话切换基准修改前后均以 `SESSION_TAB_SWITCH_RUNS=1`、端口 4467 串行运行。Review 关闭冷/热 `stableObservedMs` 为 48.0/28.8 → 44.7/29.3，打开冷/热为 45.6/45.0 → 44.5/31.9；错误目标、空白和未知样本均为 0。单轮数据不作统计性性能结论。
- 当前版本 `bun run build.ts --channel dev --audit-only` 在最终布局修正后重新运行，退出码 0，品牌兼容审计通过；未修改版本适配器或构建框架。日志保存在 `.xcode/html-reasoning-{card,layout}-*.log`，本轮未提交、推送、打包或发布。

### 技能触发独立卡片（2026-09-11）

`skill` 工具从连续普通工具调用分组中排除，每次技能触发独立显示为默认展开的专用卡片，直接呈现技能名称、加载说明与状态，无需先展开“工具调用”分组。技能卡片同时作为普通工具分组的边界；相邻的普通工具仍按既有规则单独计算连续分组，原始输入输出及会话 JSON 保持不变。

- 新增离线 HTML 回归覆盖技能卡片默认可见、连续多个技能分别展示、技能与普通工具分组隔离，以及原始 JSON 一致性；完整导出 Playwright 共 `21 passed`。
- app 单元测试 `792 pass`、浏览器测试 `92 pass`，session-ui 测试 `107 pass` 且类型检查通过；当前版本品牌兼容审计退出码 0。

## 260910-02 正式发行准备（2026-09-10）

本轮正式发行范围包含问题整卡归用户侧、助手答复分段、子智能体摘要卡片与详情弹窗，以及 HTML 页眉统一使用 `CodeAgent`。发布前重新运行 app 单元测试 791 项、浏览器测试 43 项、离线 HTML 测试 15 项和应用导出集成测试 3 项，全部通过；`git diff --check` 通过。完整类型检查仍受前次记录的 Windows 声明文件检出问题和既有类型错误影响，本轮未通过修改无关代码或降低检查强度规避。

正式候选将从本轮干净实现提交构建，使用发行号 `260910-02`。构建完成后核对清单中的提交、版本、ZIP 大小、SHA-256、品牌兼容、解压目录和真实应用启动结果，再创建 annotated tag 和 GitHub Release；实际结果以该 Release 及其 `release-manifest.json` 为准。

## 最新 Dev 测试包（2026-09-10）

用户要求后执行 `bun run build.ts --channel dev`，包含当前工作区问题整卡归用户侧、子智能体弹窗及 CodeAgent 署名，rendererVersion 为 8。构建退出码 0；品牌兼容、ZIP/解压目录和真实应用启动、renderer 就绪、干净退出验收均通过。

- 文件：`BluedCode-Dev-1.18.18-dev-46cde0909b-windows-x64.zip`，167103086 字节。版本中的 commit 是基线，当前修改尚未提交。
- SHA-256：`541164c059e1a08cc5432ca86902ee0bff2bf07f2f29cdec9efc93aafdae14a0`，已核对原始产物、清单及测试副本。
- 构建产物：`.xcode/bluedcode/workspaces/dev-c5fc0a3873297b0a/artifacts/5e4e86da5ce63292f073da1fea192864ed9a0815605fe2aa8677c25c4c13715d/`。
- 短路径测试包：`.xcode/local-test/dev-html-cards/BluedCode-Dev.zip`，已在同目录解压，程序路径长度 119 字符。未覆盖原有 Dev 测试目录或停止用户程序。
- 日志：`.xcode/html-cards-dev-package.log`。未提交、推送或发布。

## 问题卡片整体归用户侧（2026-09-10）

用户澄清要将整张问题卡片归到用户侧，之前只迁移答案的解释不符合要求。本节替代下文早期“问题保留助手侧”的展示方案：题目、选项、已选状态和答案统一放入一张右对齐问题卡片，助手前后的输出分段；不额外制造空助手卡片。无合法回答时仍在用户侧展示，但身份标为“问题”并保留未回答/缺失状态，不伪造回答。原始 JSON 不变，渲染器版本升为 8。

BluedCode 构建兼容性：只修改独立 HTML 渲染器和样式，不改 Desktop 依赖图、品牌节点、产品名称、CLI、更新、Deep Link 或数据隔离；无需更新适配器和构建框架。`bun run build.ts --channel dev --audit-only` 退出码 0，审计通过。

- 新增整卡身份、题目/选项同属用户卡片、助手不包含问题的断言，先复现 3 项失败，再修正渲染。离线 Chromium 15 项全部通过，包含跨批次续答、无回答状态、多题多选和子智能体弹窗回归。
- V1/V2 导出及中文入口集成共 3 项通过，新增验证实际导出的题目位于用户卡片、助手区域不存在问题卡片；JSON 比较保持一致。
- 桌面与手机截图已人工检查，预览 `.xcode/session-html-export-preview.html` 已更新。本轮只修正离线卡片的归属，未修改应用会话切换逻辑，沿用上文生产基准记录。
- 日志 `.xcode/html-question-side-{red,green,integration,audit}.log`。本次未提交、打包或发布。

## 子智能体详情弹窗（2026-09-10）

按 `ORIGIN-09` 最新展示合同，任务卡片改为默认折叠的摘要按钮，只呈现任务名称、类型、状态与查看详情提示；委派内容、返回结果、原始数据放入原生 `dialog`，通过 `showModal()` 打开。支持键盘打开、Esc、关闭按钮和遮罩关闭，恢复卡片焦点，长内容只在弹窗内部滚动。原始 JSON、CodeAgent 署名和问答分段不变，渲染器版本升为 7。

BluedCode 构建兼容性：仅修改离线渲染器、CSS 和既有类型化文案，不新增依赖或产品名称，不修改品牌目标节点、CLI、更新、Deep Link 或数据隔离；无需修改适配器、专用钩子或通用框架。`bun run build.ts --channel dev --audit-only` 退出码 0，品牌兼容审计通过。

- 更新交互断言后，旧版因详情仍默认可见而失败；实现后离线 Chromium 15 项全部通过，覆盖初始隐藏、打开详情、原始数据展开、键盘与关闭行为、焦点恢复、多个任务切换及手机长内容滚动。
- 补充弹窗内复制回归，先复现弹窗内无复制反馈，再将离线复制的临时文本节点和反馈限制在当前模态窗口中，避免原生 dialog 的 inert 背景干扰复制。禁用异步剪贴板 API 的真实浏览器测试通过。
- app 单元测试 791 项通过，0 失败；桌面紧凑卡片、桌面/手机弹窗截图检查通过。合成预览已刷新，原始 JSON 不变。
- 日志：`.xcode/html-task-dialog-{red,copy-red,green,unit,audit}.log`。本轮未生成新包或发布 Release。

## HTML 品牌署名调整（2026-09-10）

按 `ORIGIN-09` 的新增要求，HTML 页眉及导出展示元数据统一使用 `CodeAgent`，不再继承桌面应用的 `BluedCode` 品牌名。`createSessionHtml` 固定署名并移除调用方的产品名参数，下载模块移除 `@foreachcode/product` 引用，渲染器版本升为 6。会话标题、正文及内嵌原始 JSON 保持原样，避免改变用户记录。

- 品牌元数据断言先复现旧值 `BluedCode` 不满足 `CodeAgent`，修改后单元测试通过；14 项离线浏览器测试通过，覆盖实际页眉、问答分段、子智能体卡片及原始数据一致性。合成预览已重新生成。
- BluedCode 构建兼容性：仅减少离线下载模块对产品配置的依赖；不改品牌规则目标节点，新增页面署名 `CodeAgent` 是用户明确要求，不改变 Desktop 名称、CLI、更新、Deep Link 或数据隔离。无需调整适配器、专用钩子或通用构建框架；`bun run build.ts --channel dev --audit-only` 退出码 0，兼容审计通过。
- 本次只调整导出署名，没有改变会话切换或时间线逻辑；延续上一节卡片改动的生产基准记录，不重复进行机器波动测量。
- 日志：`.xcode/html-codeagent-{red,unit,browser,audit}.log`。本次未提交、打包或发布。

## 问答分段与子智能体卡片扩展（2026-09-10）

对应根仓 `ORIGIN-09` 本次合同扩展，属于现有离线渲染流程的局部调整。

- `question` 的问题与选项保留在助手侧；仅将已完成且有合法 `metadata.answers` 的回答投影为独立用户卡片，以工具结束时间显示回答时间，缺少时间不伪造。用户答复之后新建助手段，跨原始消息、分批渲染和交错 parent 的延续仍归入正确段。空答案数组保留“无答案”，等待、取消、缺失记录不伪造用户回答。
- `task` 使用专用卡片，展示任务描述、智能体类型、状态、委派正文与安全 Markdown 返回结果；原始输入输出折叠保留。识别当前版本完整 task 输出封装中的任务状态，后台调用返回不误报任务完成；不导出独立子会话或新增远程请求。
- 只改离线渲染器、样式、已有类型化文案与对应测试，原始 JSON 和应用导出入口保持原样，渲染器版本升为 5。
- 验证覆盖问答前后分段、多次提问、跨批次与不同 parent 隔离、未回答快照、子任务状态、安全文本和手机布局，并运行现有离线测试、生产基准和品牌兼容审计。

### BluedCode 构建兼容性

不影响 Desktop 构建依赖图，不修改品牌规则目标文件或语义节点，不新增用户可见产品名称，不影响 CLI 入口剔除、更新禁用、Deep Link 或数据隔离。`bun run build.ts --channel dev --audit-only` 退出码 0，品牌兼容审计通过，无需更新当前版本适配器、专用钩子或通用构建框架。本轮没有生成新安装包或修改已发布 Release。

### 本轮验证记录

- 先更新问答身份和分段断言并新增子智能体回归，4 项测试按预期失败（答复身份仍是助手、分段数量不足、子智能体卡片不存在）。实现后离线 Chromium 共 14 项通过，包含合成完整对话的桌面/手机截图和原始 JSON 一致性检查。
- app 单元测试 791 项通过，0 失败。生产构建与品牌兼容审计通过；本轮未重跑已知存在声明文件检出问题的全量类型检查。
- 应用导出集成首次有两项旧卡片数量断言失败：固定会话包含 6 次已回答的提问，且首轮问答后还有子任务，因此新增 6 张用户答复和 1 段助手续答，从 144 张增加为 151 张。原始 JSON 比较通过；已同步测试为验证新增用户卡片的身份与完整答案，重跑 3 项全部通过，覆盖 V1/V2、JSON 导出回归、命令面板、上下文入口和中文词典。
- V2 生产基准前后串行运行，`SESSION_TAB_SWITCH_RUNS=1`、端口 4467。Review 关闭冷/热 `stableObservedMs` 为 49.8/31.5 → 56.7/31.8 ms；打开时为 48.2/32.0 → 43.0/29.9 ms，空白、错误目标和未知样本均为 0。单轮结果不作统计性性能结论。
- 修改源码前的 V1 基准已因找不到 `Uncommitted changes inquiry` 标题失败，没有获得指标；保留失败记录，不将本轮宣称为全部基准通过。此次只修改离线 HTML 展示，没有修改应用会话切换逻辑。
- 原始日志位于 `.xcode/html-cards-{red,green,unit,audit,before,after,integration,integration-verified}.log`。合成预览 `.xcode/session-html-export-preview.html`，配套桌面/手机截图已检查；不含真实用户会话。
- 本次新增改动保留在工作区，尚无满足扩展合同的完成提交，因此暂不改写根仓版本实现矩阵中的历史完成提交。

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
