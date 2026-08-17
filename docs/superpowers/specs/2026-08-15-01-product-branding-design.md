# OpenCode 1.18.18 BluedCode Windows Desktop 品牌构建设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/01-product-branding.md`（`ORIGIN-01`）
- 目标基线：OpenCode tag `v1.18.18`
- 基线提交：`31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`
- 实现分支：`dev-foreachcode-1.18.18`
- 目标平台：Windows x64
- 目标产物：单文件免安装 Portable EXE
- 状态：历史实现，待迁移到 `2026-08-16-03-product-profile-architecture-design.md`

> 本文保留 1.18.18 构建期派生方案的历史设计与验证证据。后续实现以新的产品 Profile 混合架构设计为准；本文中的“不得修改源码”和完成结论不再作为当前交付合同。

## 1. 实现目标

在不修改 OpenCode 1.18.18 已有受跟踪源码的前提下，通过子仓自带的品牌构建框架和精确版本适配器生成 BluedCode Windows x64 Portable EXE。

构建从当前 OpenCode 工作区只读加载源码和已有 `node_modules`，在 Electron Vite、Rollup 和 Electron Builder 管线中定点转换用户可见产品身份，并把所有缓存、派生资源、中间 bundle 和产物写入隔离目录。

本设计不把上游源码改造成通用多品牌框架。1.18.18 的文件映射、语义指纹、转换规则和结构性入口剔除都属于该版本适配器。

## 2. 已确认范围

### 2.1 包含

- Electron main、preload 和 renderer；
- renderer 使用的 `packages/app` 与 `packages/ui` 代码；
- Desktop 运行所必需的内嵌 OpenCode server/runtime；
- Windows x64 `dev` 和 `prod` channel；
- BluedCode 图标、Wordmark、favicon、Windows 文件属性和 Portable EXE；
- `prod` 的正式发行版本、manifest 和 Git tag 账本；
- Deep Link 注册、Portable 路径刷新和 channel 数据隔离。

### 2.2 排除

- 独立 CLI、CLI 安装入口和后台 CLI；
- WSL CLI 安装与管理入口；
- 独立 Web 与 TUI 产品入口；
- SDK、Enterprise、macOS、Linux 和 Windows ARM64 品牌发行；
- NSIS、MSI、ZIP、Microsoft Store；
- 自动更新、自动发布、Sentry 上传和代码签名。

Desktop 依赖的内部 server/runtime 可以继续包含上游 CLI/server 模块和 `OPENCODE_*` 协议，但不得暴露为用户可执行的 BluedCode CLI 产品。

## 3. 1.18.18 基线现状

`dev-foreachcode-1.18.18` 当前基线与 tag `v1.18.18` 指向同一提交。版本实现只能以 Git 跟踪的基线文件为依据；切换分支后遗留的 ignored 文件、旧缓存和旧构建输出都不是 1.18.18 源码输入。

### 3.1 Desktop 打包

`packages/desktop/electron-builder.config.ts` 当前直接定义：

- `ai.opencode.desktop*` app ID；
- `OpenCode*` productName；
- `opencode://` 协议；
- OpenCode artifactName、Linux 配置和 GitHub publish 目标；
- NSIS、macOS 和 Linux 等本需求不需要的 target。

版本实现不修改该文件，而是提供 BluedCode 独立 Electron Builder 配置，只保留 Windows x64 `portable` target。

### 3.2 Electron 编译

`packages/desktop/electron.vite.config.ts` 定义 main、preload、renderer、内嵌 server 模块和 App Vite 插件。Electron Vite 5 已提供外部 `--config` 和 `--outDir`，因此版本实现可以从 `xcode/build/bluedcode/` 加载独立配置并把输出写到隔离目录。

### 3.3 运行时身份

`packages/desktop/src/main/index.ts` 当前直接声明 OpenCode app name、app ID、`opencode://`、AppData 路径、后台 CLI 和内嵌 server 认证身份。

`packages/desktop/src/main/windows.ts` 当前包含窗口标题以及 OpenCode 命名的窗口状态键。`packages/desktop/src/renderer/index.html` 当前包含 OpenCode 标题和上游 favicon。

这些文件由版本适配器在内存中转换；磁盘内容保持不变。认证用户名、内部存储字段等纯技术身份只有在产品合同要求时才转换，否则进入保留白名单。

### 3.4 多语言与产品入口

Desktop renderer 与共享 App 的语言文件包含大量 OpenCode 产品名以及 CLI、WSL CLI 引导文本。适配器必须按语言值分类：

- Desktop 产品身份转换为 BluedCode；
- OpenCode Zen、OpenCode Go 等服务名称保留；
- CLI 和 WSL CLI 用户功能从 Desktop 构建图中剔除，对应不可达文本不进入产物；
- key、变量名、API 字段和内部模块名保持不变。

### 3.5 内嵌 server

`packages/opencode/script/build-node.ts` 当前把 Node bundle 写入包内 `dist/node`。BluedCode 构建入口复用其入口、define、external 和生成数据语义，但由公共构建框架执行可配置输出的 `Bun.build`，不调用会固定写入上游目录的原脚本。

内嵌 server 继续使用 `OPENCODE_CLIENT=desktop`、`OPENCODE_*` 和其他上游内部协议。对外品牌参数由 BluedCode 构建入口解析后映射到这些内部值。

## 4. 产品身份

| 身份      | `prod`                           | `dev`                                |
| --------- | -------------------------------- | ------------------------------------ |
| 显示名    | `BluedCode`                      | `BluedCode Dev`                      |
| slug      | `bluedcode`                      | `bluedcode`                          |
| app ID    | `ai.bluedcode.desktop`           | `ai.bluedcode.desktop.dev`           |
| Deep Link | `bluedcode://`                   | `bluedcode-dev://`                   |
| userData  | `%APPDATA%\ai.bluedcode.desktop` | `%APPDATA%\ai.bluedcode.desktop.dev` |

应用启动时在 `app.ready` 之前设置 app name、app ID 和 userData。协议注册必须使用当前 Portable EXE 的绝对路径；每次启动检查注册值，EXE 被移动后以当前路径刷新。

BluedCode 不读取或迁移 `ai.opencode.desktop*`、其他 BluedCode channel 或其他产品的数据。首次运行始终使用空白的当前 channel 数据边界。

## 5. 目录与职责

根仓维护源：

```text
xcode/build/bluedcode/
├── brand.json
├── app-icon.svg
├── app-icon.png
├── wordmark.svg
├── tui.json
├── common/
└── snapshot-manifest.json
```

子仓独立快照：

```text
opencode/xcode/build/bluedcode/
├── brand.json
├── app-icon.svg
├── app-icon.png
├── wordmark.svg
├── tui.json
├── common/
├── snapshot-manifest.json
├── build.ts
├── version/
│   └── 1.18.18/
│       ├── index.ts
│       ├── baseline.json
│       ├── rules/
│       │   ├── identity.ts
│       │   ├── renderer.ts
│       │   ├── locales.ts
│       │   ├── assets.ts
│       │   ├── disable-cli.ts
│       │   └── preserved-identities.ts
│       └── tests/
└── test/
```

根仓可分发文件必须逐文件复制到子仓，不能使用符号链接或父级相对路径。`snapshot-manifest.json` 记录公共文件相对路径、SHA-256 和框架版本；同步发现子仓公共文件存在未确认修改时失败，不得静默覆盖。

`tui.json` 保留在公共资源快照中并参与快照完整性校验，但 1.18.18 Desktop 资源清单必须明确排除。它不参与 Desktop 视觉摘要、转换缓存和最终打包。

## 6. 通用转换引擎

公共引擎提供以下能力：

- 严格解析 BluedCode 配置和构建参数；
- 验证平台、架构、Git 基线、工作区和 tag 状态；
- 读取 Git 跟踪的上游输入；ignored overlay 不进入缓存键、转换输入、构建图和产物，但不再作为本轮 prod 本地构建阻塞项；
- 解析 TypeScript、JavaScript、HTML、JSON 和资源文件；
- 按规则执行字符串节点、对象属性、HTML 节点、模块 alias 和资源转换；
- 支持版本专用 AST 转换钩子；
- 对每条规则执行精确命中计数；
- 生成转换 ledger、保留白名单和未分类引用报告；
- 管理内容寻址缓存和隔离输出；
- 检查 ASAR、Portable EXE、Windows 元数据与运行行为。

通用引擎不得包含 `1.18.18` 文件路径或该版本专用条件。

### 6.1 规则模型

每条规则至少包含：

```text
id
target file
parser/transform kind
semantic selector
expected source value
replacement value
expected match count
classification
reason
```

规则只处理声明的语义节点。禁止对整个文件、bundle、ASAR 或 EXE 执行无边界的 `OpenCode -> BluedCode` 全局替换。

### 6.2 失败策略

以下情况在编译或打包前失败：

- 基线 tag、受控语义指纹或公共快照不匹配；
- 规则零命中、重复命中或命中未声明文件；
- 新增未分类的 OpenCode 产品身份；
- BluedCode 产品身份出现在不允许硬编码的上游源码；
- 无效品牌资源、派生资源或输出路径；
- 构建过程改变 Git 跟踪内容。

测试必须人为删除目标、复制目标和改变原始值，验证三个场景均会失败。

## 7. 1.18.18 版本适配器

版本适配器由小文件组合，不把所有规则堆入单个 `1.18.18.ts`。

- `baseline.json`：记录 `v1.18.18`、基线提交和受控语义指纹；
- `identity.ts`：app name、app ID、Deep Link、userData 和 Windows 文件属性；
- `renderer.ts`：HTML 标题、用户可见产品名和 UI 入口；
- `locales.ts`：Desktop 产品身份值、服务名称保留规则和不可达 CLI 文本；
- `assets.ts`：App Icon、Wordmark、favicon 与 TUI 排除；
- `disable-cli.ts`：删除或禁用安装 CLI、后台 CLI、WSL CLI 管理入口；
- `preserved-identities.ts`：`.opencode`、`OPENCODE_*`、包名、API 和服务专有名白名单。

普通替换使用声明式规则。删除菜单项、preload API、IPC 注册或 App 条件分支等结构变化使用版本专用 AST 钩子，并对转换前后的结构分别断言。

## 8. 外部构建配置

版本实现提供独立 Electron Vite 配置：

- 读取上游 main、preload 和 renderer 入口；
- 合并上游 App Vite 插件所需能力；
- 在 `enforce: pre` 阶段执行品牌适配器；
- 把内嵌 server 指向隔离 bundle；
- 把 main、preload、renderer 输出写入当前构建 stage；
- 不调用上游 `prebuild` 中会复制 OpenCode 图标、metainfo 或 CLI 的步骤；
- 清空 Sentry DSN、token、组织、项目和 release 参数。

独立 Electron Builder 配置只声明：

- Windows x64；
- `portable` target；
- 当前 channel 的 app ID、productName 和 Deep Link；
- BluedCode 派生 `.ico`；
- 精确 artifactName；
- 禁用 publish、updater、signing 和其他平台配置。

## 9. 视觉资源处理

公共引擎验证 App Icon SVG、PNG 和 Wordmark：

- SVG 必须具有正尺寸 viewBox，禁止脚本、事件、外部 URL、DOCTYPE、ENTITY、`foreignObject`、嵌入对象和远程资源；
- App Icon 必须为正方形并具有 `BluedCode application icon` 标题；
- PNG 必须签名有效、宽高相等；
- 相同内容在不同绝对目录中产生相同规范摘要。

构建在隔离 stage 中生成 Windows `.ico` 和 renderer favicon，并通过 alias 或虚拟模块替换 Desktop 使用的 OpenCode Logo、Wordmark 和图标。不得写回 `packages/desktop/resources`、`packages/app/public` 或 `packages/ui`。

## 10. CLI 与非 Desktop 入口剔除

1.18.18 适配器必须从最终 Desktop 构建图和用户界面中移除：

- 安装 CLI 的菜单、renderer 调用、preload API 和 IPC handler；
- dev 构建下载或携带独立 CLI 的步骤；
- 后台 CLI 启动与发现入口；
- WSL 中安装、探测、升级和管理 OpenCode CLI 的用户操作；
- 独立 Web 与 TUI 的启动、资源和可执行产物。

为维持 Desktop 内嵌 server/runtime 所需的内部模块可以保留，但必须证明不存在可由用户调用的独立 CLI 入口。

## 11. 构建入口与版本

开发产物：

```text
bun xcode/build/bluedcode/build.ts --channel dev
```

版本格式与产物名：

```text
1.18.18-dev-<10位commitid>
BluedCode-Dev-1.18.18-dev-<10位commitid>-windows-x64-portable.exe
```

正式产物：

```text
bun xcode/build/bluedcode/build.ts --channel prod --release 260815-01
```

版本格式与产物名：

```text
1.18.18-260815-01-<10位commitid>
BluedCode-1.18.18-260815-01-<10位commitid>-windows-x64-portable.exe
```

构建器从 `packages/desktop/package.json` 或经验证的 workspace 版本读取 `1.18.18`，从子仓干净 HEAD 自动读取 10 位 commit ID。正式构建拒绝 dirty tracked/untracked 输入；ignored overlay 不得进入依赖图和产物，但按用户 2026-08-16 “放宽一点”的裁决不作为本轮阻塞项。commit ID 不能由参数覆盖。

Windows PE 数字版本独立派生，产品展示版本、文件名、诊断信息和 manifest 保留完整组合版本。

## 12. 正式发行账本

正式 tag 格式：

```text
bluedcode-v1.18.18-260815-01
```

`NN` 在同一日期跨 OpenCode 小版本全局递增。正式构建前必须刷新并检查远端 BluedCode tags，拒绝重复、回退或跳号；`dev` 不创建 tag，也不占用序号。

构建成功只生成发行候选。完成全部验收后才创建 annotated tag，tag 中文说明记录完整版本、完整 commit ID 和产物摘要。并发发布产生相同 tag 时，Git 远端拒绝后发者，后发构建必须重新分配序号。

与 Portable EXE 同目录生成 `release-manifest.json`，至少包含：

- 产品、channel、平台和架构；
- OpenCode 基线、完整产品版本和完整 commit ID；
- 目标 tag；
- 公共框架、版本适配器和视觉资源摘要；
- Portable EXE 文件名、大小和 SHA-256；
- 构建时间、构建工具版本和审计结果。

## 13. Portable 与 Deep Link

产物使用 Electron Builder Windows `portable` target。它是免安装 EXE，但用户数据仍保存在 AppData，不在 EXE 同目录创建数据文件。

应用每次启动检查当前 channel 的协议注册：

- `prod` 注册 `bluedcode://`；
- `dev` 注册 `bluedcode-dev://`；
- 注册命令指向当前 Portable EXE 绝对路径；
- 路径变化时更新注册；
- 不接管另一个 channel 或 `opencode://`。

运行验收必须把 EXE 移动到第二个临时目录，重新启动并验证协议注册已指向新位置。

## 14. 更新、发布、遥测与签名

版本适配器必须关闭 Electron updater 初始化和所有 publish 配置，不能读取或联系 anomalyco/OpenCode 的发行仓库。

构建环境必须清空 Sentry 及上游发布、签名凭据。Portable EXE 不执行代码签名，manifest 和发布说明必须标明 Windows SmartScreen 可能显示未知发布者。

本设计不实现 BluedCode 更新源、发布上传或签名服务；后续需求若引入这些能力，必须单独设计并重新通过品牌构建兼容性门禁。

## 15. 缓存与快速构建

构建不复制 `node_modules`。操作者仅在首次 clone 或 `bun.lock` 变化时运行：

```text
bun install --frozen-lockfile
```

后续构建复用当前子仓依赖，以及 Electron、Electron Builder 和 NSIS 工具下载缓存。即使最终不生成 NSIS，Electron Builder 的 Windows portable 工具链缓存仍由统一下载缓存管理。

当前实现已落地 server bundle 内容寻址缓存，并复用当前子仓 `node_modules`、Electron、Electron Builder、NSIS/7-Zip 工具下载缓存。以下阶段缓存作为跨版本目标保留，但不作为本轮 1.18.18 交付阻塞项：

- AST 解析与模块转换；
- 内嵌 server；
- Electron main 与 preload；
- renderer；
- `.ico` 与 favicon；
- 未签名 Portable 打包输入。

缓存键至少组合 OpenCode commit、`bun.lock`、Bun/Electron 版本、Windows x64、公共框架摘要、版本配置摘要、品牌资源摘要和 channel。与品牌无关的依赖和 server 输入可以在 channel 间共享；包含身份信息的 main、renderer 和打包阶段必须隔离。

第二次完全相同的构建必须至少报告 server cache 命中和工具缓存命中；未落地的 transform/main/preload/renderer/assets/package input 分阶段缓存作为后续优化。命中缓存后仍执行输入校验、产物扫描和 manifest 生成。

## 16. 测试设计

### 16.1 公共引擎测试

- 配置字段、类型、路径和资源校验；
- TypeScript、HTML、JSON 与资源转换；
- 精确命中计数和转换 ledger；
- 未分类引用与保留白名单；
- 源文件删除、重复和内容变化时失败；
- 缓存键、命中、失效和 channel 隔离；
- 根仓到子仓快照摘要一致性。

### 16.2 1.18.18 适配器测试

- 所有规则在 `v1.18.18` 受跟踪源码上精确命中；
- 其他 tag 或变化后的语义指纹被拒绝；
- app name、app ID、协议、userData 和窗口标题转换正确；
- Desktop 多语言产品名转换完整，服务专有名保持不变；
- CLI、后台 CLI 和 WSL CLI 入口不可达且不进入最终构建图；
- TUI 资源被明确排除；
- 更新、publish、Sentry 和签名配置为空。

### 16.3 产物静态验收

- 只存在目标 Portable EXE 与 manifest；
- 文件名、PE 展示版本、产品名和图标正确；
- 解包产物后不存在未分类的用户可见 OpenCode 产品身份；
- 内部协议白名单完整且没有被误替换；
- EXE SHA-256 与 manifest 一致；
- 构建前后 Git 跟踪内容一致。

### 16.4 运行验收

- 使用全新临时 AppData 启动 `dev` 和 `prod`；
- 验证两个 channel 可以并存且数据互不可见；
- 验证窗口、菜单、通知、引导和可达语言文本使用 BluedCode；
- 验证没有 CLI、WSL CLI、更新和发布入口；
- 验证不会读取或修改 OpenCode Desktop 数据；
- 验证两个 Deep Link 分别唤起对应 channel；
- 移动 Portable EXE 后验证协议路径刷新。

## 17. 后续源码需求的兼容门禁

后续 spec 若修改 OpenCode 源码，必须先判断是否影响本版本品牌规则：

1. 无影响时仅记录审计通过；
2. 语义目标未变时重新确认指纹；
3. 声明式规则可以覆盖时更新版本配置；
4. 结构变化时更新 1.18.18 专用钩子；
5. 只有出现多版本可复用能力时才扩展公共引擎。

源码需求在品牌兼容审计失败时不能标记完成。本章节要求同时受父级根仓 `AGENTS.md` 约束。

## 18. 小版本升级流程

升级到 1.18.19 等后续 tag 时：

1. 从完成的 `dev-foreachcode-1.18.18` 创建新版本分支；
2. 合入新的 OpenCode tag，合并提交使用中文说明；
3. 复制 `version/1.18.18/` 为新 tag 的薄适配起点；
4. 对比受控文件和依赖入口；
5. dry-run 规则并分类新增品牌引用；
6. 只调整失败的规则、指纹和专用钩子；
7. 保存新 tag 的精确配置并执行完整 Windows验收。

未经审计不得把 `1.18.18` 配置声明为 `1.18.x` 通用配置。

## 19. 实施完成条件

实现只有在以下条件全部满足后才算完成：

1. `packages/**`、现有 workspace 配置、lockfile 和 `node_modules` 没有品牌实现修改。
2. 根仓公共框架与资源已经完整复制到子仓并通过摘要验证。
3. 子仓独立 clone 可以构建 Windows x64 Portable EXE。
4. `dev` 和 `prod` 的身份、数据与 Deep Link 隔离通过运行验收。
5. 用户可见产品品牌无漏换，技术协议无误换。
6. CLI、WSL CLI、Web、TUI、更新、发布、Sentry 和签名入口符合排除要求。
7. 故障注入证明版本适配器会在上游结构变化时失败。
8. 第二次相同构建至少命中 server 与工具缓存；其余分阶段缓存不阻塞本轮交付。
9. `prod` 发行序号通过 tag 账本校验，manifest 完整。
10. 父级 origin spec 的版本实现矩阵只在完成上述验收后更新。

如果实施过程中发现必须修改任何现有上游受跟踪文件，必须立即停止并重新评审，不得自行扩大本设计范围。

## 20. 1.18.18 实施结果

本版本实施按用户要求 squash 为单一子仓提交；最终 commit 与 prod 产物必须以本轮修复完成后的重新构建结果为准。根据用户 2026-08-16 明确要求“放宽一点”，本次把 Task 7 后续供应链硬化项和未完成的全阶段缓存降级为后续改进，不再阻塞当前 Windows x64 Desktop Portable 交付。

已完成并验证：

- 构建框架通过构建期派生源码实现品牌转换，没有修改 `packages/**`、lockfile、现有 workspace 配置或 `node_modules`；
- 产物仅覆盖 Windows x64 Desktop Portable，CLI、WSL CLI、Web、TUI、更新、发布、Sentry 和签名入口被排除或禁用；
- `dev` channel 真实构建成功，最终 Portable EXE 与 `release-manifest.json` 两文件发布目录通过 exact 审计；
- 最终 EXE 由锁定 7-Zip 26.02 只读提取并与同次 sibling exact 对比通过；
- ASAR exact 973 项，native unpack exact 17 项，唯一 native EXE 为签名有效的 OpenConsole；
- 外层与内层品牌 PE 必须为 ProductName `BluedCode`/`BluedCode Dev`，FileVersion/ProductVersion 使用完整组合版本，数字版本按 channel 派生，Authenticode `NotSigned`；
- Electron output 审计扫描未发现未分类的用户可见 OpenCode 产品身份；新建会话页 `WordmarkV2` 已通过 runtime boundary 映射到 BluedCode `wordmark.svg`，不再渲染上游 OpenCode v2 字标；
- BluedCode 新装默认使用 V1 布局，设置页始终显示“新布局”开关，用户可手动切换到 V2；上游旧界面 sunset 和升级强制 V2 逻辑已在构建期适配中禁用；
- 启动 smoke 使用临时 AppData/LocalAppData 启动新 EXE，12 秒后进程仍在，窗口标题为 `BluedCode Dev`，未出现 `JavaScript error` / `Error` 窗口；
- 最终 xcode 测试 `165 pass / 0 fail / 1319 expect()`，本轮改动文件 oxlint `0 warnings / 0 errors`，Prettier 与 diff check 通过。

最终 dev 产物：

```text
修复后需重新生成当前 HEAD 对应的 dev/prod Portable 产物，并以 `release-manifest.json` 记录的路径、大小和 SHA-256 为准。
size    166175105 bytes
sha256  46e8c4d68583b0d290083e1a268c79a5d7ff805572ebd99f4b989eec5c659d31

D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-894db73f82a2c19f\artifacts\fbb86fe1d13f0e0023a0d62f0f55577910d281f2b25ffdf6178506b391aeffd1\release-manifest.json
size    152406 bytes
sha256  59c183553d90506e432487cadd9107054f6d577597de722cbf7a25b6d1b6ea2d
```

放宽后未作为本轮阻塞的事项：

- 真实 `prod` fetch/tag/push/release 未执行，正式发布前仍需按 release 账本重新验收；
- 完整 Windows 运行验收仍需在正式发布前执行；Deep Link 路径刷新和 AppData/server XDG 数据边界已纳入本版本 adapter 测试与构建审计；
- `afterSign` 资源编辑工具图可以进一步收紧为早于任何 PE 读取；
- `resedit` / `pe-library` 包目录可以进一步枚举全子树，拒绝额外未使用 reparse 项；
- 产物 unsigned，Windows SmartScreen 可能显示“未知发布者”。
