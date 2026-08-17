# OpenCode 1.18.18 BluedCode 产品 Profile 混合架构设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/07-product-profile-architecture.md`（`ORIGIN-07`）
- 关联需求：`ORIGIN-01`、`ORIGIN-02`
- 目标基线：OpenCode tag `v1.18.18`
- 基线提交：`31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前完整实现：`4b777025b908cd81a4b98c0457b2360059ea3b92`
- 目标平台：Windows x64 Desktop
- 目标产物：单文件免安装 Portable EXE
- 状态：1.18.18 已实现；2026-08-17 可持续性收敛设计已确认，待计划与实施

## 1. 实现目标

在 1.18.18 已完成的混合架构基础上，把产品身份、企业策略和配置边界进一步收敛到少数源码根服务，同时保留已经成熟的资源、打包、缓存和最终产物审计。

本分支只构建 BluedCode，不承担同一源码树切换回原始 OpenCode 的能力。未来更换品牌时，创建新的静态产品 Profile，并同步改变 app ID、协议和全部数据边界；不复用 BluedCode 的 AppData、`.config/bluedcode`、缓存、日志或窗口状态。

实施后，构建工具不负责修补业务语义。它读取源码中的产品 Profile，完成视觉品牌、多语言静态文案、Windows Portable 装配和最终审计。根仓不保存构建代码；`opencode/xcode/build/bluedcode` 是构建框架和版本适配器的唯一实现位置。

## 2. 迁移原则

采用逐项替换而不是一次性推翻：

1. 保留现有构建测试和可运行产物作为迁移基线。
2. 为一项产品行为先添加源码级失败测试。
3. 在源码服务边界实现该行为并使测试通过。
4. 删除对应的构建期语义转换和冗余指纹。
5. 重新执行构建兼容审计和运行验收。
6. 全部行为迁移完成后再重整 Git 历史。

任何阶段不得同时保留两套互相独立的策略来源。短暂过渡时，构建侧只能断言源码行为，不得覆盖源码结果。

## 3. 产品包

新增独立 workspace package：

```text
packages/product/
├── package.json
├── src/
│   ├── index.ts
│   ├── profile.ts
│   ├── capability.ts
│   ├── identity.ts
│   └── error.ts
└── test/
```

包名为 `@foreachcode/product`，使用纯 TypeScript，不增加外部运行时依赖。它位于依赖图底层，不依赖 `core`、`opencode`、`app`、`desktop` 或构建工具。

生产代码只导出一个深度只读的 BluedCode Profile。测试可以导入纯函数验证派生逻辑，但不得提供运行时品牌切换、环境变量覆盖或用户配置覆盖。

### 3.1 Profile 结构

```ts
type ProductProfile = {
  identity: {
    displayName: "BluedCode"
    directoryName: "bluedcode"
    appId: "ai.bluedcode.desktop"
    protocol: "bluedcode"
  }
  capabilities: {
    desktop: true
    cli: false
    web: false
    tui: false
    updater: false
    publicShare: false
    telemetry: false
    publicProviderCatalog: false
    providerManagement: "admin-static-only"
  }
  operations: {
    "config.write.preference": "allow"
    "config.write.integration": "deny"
    "provider.read": "allow-admin-static"
    "provider.manage": "deny"
    "auth.manage": "deny"
    "mcp.manage": "deny"
    "plugin.manage": "deny"
    "share.public": "deny"
    "catalog.public": "deny"
    telemetry: "deny"
    "update.public": "deny"
    "proxy.public": "deny"
  }
}
```

`operations` 是运行时授权、管理员集成注册、UI surface、构建 manifest 和最终审计的共同事实源。构建侧不再维护独立 `EnterprisePolicy` literal；需要记录的企业策略必须由 Profile 纯函数派生。

`dev` 身份必须由纯函数确定性派生：

- 显示名：`BluedCode Dev`；
- app ID：`ai.bluedcode.desktop.dev`；
- Deep Link：`bluedcode-dev://`；
- 数据、缓存、日志和窗口状态目录使用独立 dev 身份。

### 3.2 错误模型

`@foreachcode/product` 定义稳定错误码，业务包在网络、持久化和子进程边界之前使用：

- `PRODUCT_CAPABILITY_DISABLED`
- `PROVIDER_MANAGED_BY_ADMIN`
- `CONFIG_WRITE_DISABLED`
- `PUBLIC_SHARE_DISABLED`
- `PUBLIC_UPDATE_DISABLED`

错误对象保留结构化 code 和安全 message。意外错误继续保留 cause、stack 与阶段上下文，不得被折叠成策略错误。

## 4. 源码映射

### 4.1 Core：目录与产品身份

`packages/core` 读取 Profile 的 `directoryName`，统一派生配置、数据、缓存和日志根目录。Windows 配置目录必须保持 OpenCode 原始布局规则，只替换产品目录段：

```text
C:\Users\<user>\.config\bluedcode\config.json
C:\Users\<user>\.config\bluedcode\opencode.json
C:\Users\<user>\.config\bluedcode\opencode.jsonc
```

不得改成 `ProgramData`，不得额外增加嵌套目录，也不得扫描 `.config/opencode`。配置格式、文件名和上游兼容字段继续保持原样。

### 4.2 Desktop：应用身份与入口

`packages/desktop` 直接读取 Profile 及 channel 派生身份，负责：

- app name、app ID、Deep Link 和 userData；
- Portable 移动后的协议注册刷新；
- 窗口标题、诊断版本和 sidecar 环境；
- CLI、后台 CLI、WSL 管理和 updater 能力门禁；
- 默认使用 V1 布局，并保留设置中的 V2 开关。

Deep Link、app ID 和数据目录不再由 Electron Vite AST 钩子改写。构建只验证最终值与 Profile 一致。

### 4.3 OpenCode server：企业策略

`packages/opencode` 在服务边界读取 Profile capabilities：

- Provider、model、MCP 和插件只从 `.config/bluedcode` 中的管理员静态配置解析；
- `provider`、`model`、`mcp` 和 `plugin` 配置必须正常生效；
- 环境变量凭据、Auth 存储、OAuth、插件认证、well-known 与公共目录不能增加 Provider；
- Provider 列表和模型选择只返回管理员配置后实际可用的结果；
- API key、Auth 和自定义 Provider 写入在读取敏感请求体或持久化前失败；
- 分享、自动分享、更新、公共模型刷新和公共 Web proxy 在网络前失败；
- 服务层保留只读 Provider 列表和模型能力，不能用空模块破坏调用合同。

HTTP handler 与直接服务调用必须复用同一策略函数。禁止依赖 UI 隐藏保证安全。

配置分为两条通道：管理员静态配置负责所有可能产生外联的集成；用户本地偏好只允许主题、语言、字体、快捷键、通知、V1/V2 布局和其他明确无外联副作用的字段。用户写入使用显式 schema allowlist，未知字段默认拒绝；GUI 不得回写完整管理员配置对象。

安全检查只存在于天然根边界：配置变更策略、管理员集成快照、Provider/MCP/插件注册表，以及 Auth、分享、公共目录、遥测、更新和公共代理服务。HTTP handler 不再重复实现同一 capability 判断。

### 4.4 App：可见产品行为

`packages/app` 使用 Profile 渲染能力：

- Provider 页面展示管理员已连接的静态 Provider 和模型；
- 不把管理员 Provider 显示成可由用户连接或配置的供应商；
- 不显示 OAuth、API key、自定义 Provider、断开、公共分享和检查更新入口；
- 默认 V1，设置页始终提供“新布局 / New layout”开关以切换 V2；
- 产品能力错误显示稳定、可理解的提示；意外错误显示完整可导出的诊断信息。
- 统一 `ProductUiRegistry` 负责注册设置页、操作和导航。基础本地偏好正常注册；Provider 只读视图继续注册；Provider/MCP/插件管理、OAuth、分享、更新和公共链接不注册。具体按钮不承担安全边界。

静态 locale 中的 OpenCode 产品名暂由构建期精确转换，以避免在 63 个语言文件中制造高噪声合并冲突。业务分支和错误文案不得依赖该转换。

## 5. 构建层保留能力

`xcode/build/bluedcode` 继续保留：

- `brand.json`、图标、Wordmark、favicon 和 `.ico` 派生；
- Windows x64 Portable、PE、完整产品版本和文件名；
- `dev` / `prod` identity、release ledger 和 manifest；
- 只读 `node_modules` 复用、内容寻址缓存和隔离 workspace；
- Git source 认证、ASAR/native/EXE/final payload exact 审计；
- 多语言静态产品文案和无法由资源入口覆盖的静态 Logo 转换；
- Profile、源码、bundle 和最终产物的一致性审计。

构建期必须删除下列旧职责：

- app ID、Deep Link、userData 和配置目录改写；
- V1/V2 业务逻辑改写；
- CLI、WSL、updater 运行时行为改写；
- Provider/Auth/config/share/update/models/telemetry 策略改写；
- 以空模块替代仍被 server 调用的业务合同。
- 独立于 Profile 重复声明企业能力的 `EnterprisePolicy`；
- 已不再注册但仍保留在可执行构建快照中的企业业务 AST 改写器。

## 6. 构建架构收敛

### 6.1 通用接口

公共框架导出不带版本硬编码的 `VersionAdapter`，并由显式 registry 按受信 baseline 选择：

```ts
type VersionAdapter = {
  id: string
  baseline: BaselineContract
  modules: readonly ModuleContract[]
  assets: AssetContract
  audits: readonly AuditContract[]
}
```

`build.ts`、server builder、Electron Vite、Electron Builder、manifest 和 audit 只接收 `VersionAdapter` 接口或由 registry 返回的实例，不得 import `adapter11818`。未注册 tag、commit 或 Desktop version 在 preflight 阶段失败。

新增只读 `prepare-version` 与 `adapter-diff` 工具，生成新 tag 的候选目录、受控文件摘要和结构差异报告。候选结果必须人工分类并经过测试，工具不能自动接受指纹或放宽审计。

每个 `ModuleContract` 是模块的唯一事实源，包含：

- 模块 ID、源码路径、阶段和解析方式；
- 基线语义指纹；
- 保留的静态转换与预期命中次数；
- source/server/main/preload/renderer 中的目标关系；
- 输出审计分类和故障提示。

指纹、hook targets、required build targets、测试清单和 ledger 不再由多份手写数组分别维护，而由 `modules` 派生。

locale 和其他静态品牌文案以完整 AST 字符串或同一文件中的语义块为转换单位。一段文案中的多个产品关键词不得拆成多条互相独立的规则；ledger 对同一文件的同类替换生成一条汇总记录，保留命中节点和前后摘要。

### 6.2 统一转换与审计 ledger

server 的 Bun build 与 Electron Vite 必须进入同一 ledger。每个受控模块记录：

- 阶段、相对路径、输入摘要和输出摘要；
- 规则 ID、命中数和保留原因；
- Profile 摘要与版本适配器摘要；
- source map 或符号映射位置。

最终 manifest 必须覆盖 source、server、main、preload、renderer、assets、package、portable 和 runtime 验收，不能只证明 Electron renderer 转换。

### 6.3 根仓资源与子仓构建代码

根仓 `xcode/build/bluedcode` 只保存品牌源资源和资源摘要，不保存任何 TypeScript、JavaScript 或脚本构建代码。子仓 `opencode/xcode/build/bluedcode` 是通用构建框架、版本适配器、测试和独立构建资源的唯一代码实现位置。

根仓品牌资源同步到子仓时逐文件校验，发现子仓资源存在未确认修改时失败，不能静默覆盖。构建代码不再执行根仓/子仓双向快照。

### 6.4 文件拆分

大文件按真实职责拆分：

- adapter：基线、静态品牌、locale、assets、preserved identities；
- build：preflight、compile、package、publish、runtime acceptance；
- Electron Builder：config、PE/resource、ASAR/native、Portable payload；
- audit：源码、bundle、产物、manifest。

不为一次性简单表达式创建无意义 helper；拆分目标是隔离可独立测试的边界。

## 7. 诊断设计

构建为每次运行创建稳定 run ID，并输出结构化 stage event：

```text
preflight -> source -> server -> main -> preload -> renderer
-> assets -> package -> portable -> runtime -> publish
```

每个事件包含开始时间、耗时、缓存命中、输入/输出摘要和失败上下文。失败时在隔离目录生成 failure report，记录：

- stage、错误 code、message、cause 和 stack；
- Git/Profile/framework/adapter 摘要；
- 最后完成的模块与转换 ledger；
- 可安全导出的日志与 source-map/symbol bundle 路径。

敏感配置、API key、请求体和 Provider 凭据不得进入日志、manifest 或诊断包。

failure stage 必须覆盖真实流水线，至少区分 `assets`、`portable`、`portable-startup`、`server-health`、`preload`、`renderer`、`runtime` 和 `publish`。诊断报告写入失败时必须保留原始构建错误，并额外输出脱敏的 `failure-report-unavailable` 原因。

## 8. 实施阶段

### 阶段一：产品包与最小注入

1. 创建 `@foreachcode/product` 及 Profile 合同测试。
2. 接入 Core 路径、Desktop identity 和构建配置读取。
3. 验证 `.config/bluedcode` 中三个兼容文件名均可加载。
4. 删除对应路径、app ID、Deep Link 构建转换。

### 阶段二：迁移 ORIGIN-01 行为

1. 源码实现 Desktop-only、Windows x64、CLI/WSL/updater 能力门禁。
2. 源码实现默认 V1 和 V2 设置开关。
3. 保留资源、locale、PE、Portable 与最终审计。
4. 运行品牌兼容审计，确认用户可见产品名无漏换。

### 阶段三：迁移 ORIGIN-02 行为

1. Product Profile 增加稳定操作矩阵，并统一派生运行时授权、UI surface 和 manifest 企业策略。
2. 建立管理员集成快照，Provider/model/MCP/plugin 只从受信静态配置进入注册表。
3. 建立统一配置变更策略：允许显式本地偏好 schema，拒绝外联集成和未知字段。
4. Auth、分享、更新、ModelsDev、telemetry 和 public proxy 在各自服务根的副作用前拒绝。
5. App 使用 ProductUiRegistry 注册基础设置和只读管理员视图，不注册外联管理入口。
6. 删除 handler/页面中的重复安全判断和全部对应企业构建钩子、server AST 派生规则。

### 阶段四：构建框架收敛

1. 引入通用 `VersionAdapter` registry 与 `ModuleContract[]`，移除公共流程中的 `adapter11818` 硬绑定。
2. 统一 server/Electron ledger 和 manifest。
3. 删除根仓构建代码，只保留品牌源资源；子仓成为唯一构建代码实现。
4. 删除废弃企业 AST 改写器，让 manifest 企业策略从 Product Profile 派生。
5. 增加 adapter-diff、候选指纹生成、阶段日志、failure report 和符号信息。

### 阶段五：发行验收与历史重整

1. 完成完整测试、dev/prod Portable 和 Windows 运行验收。
2. 验证配置模型、会话、V1/V2、禁用入口、Deep Link 和数据隔离。
3. 保存当前历史安全引用。
4. 从 `v1.18.18` 重建两条中文语义提交。
5. 使用 `git push --force-with-lease` 更新已确认远端分支。
6. 更新三个 origin spec 的版本实现矩阵。

## 9. TDD 与验证

所有行为按 RED → GREEN → REFACTOR 实施。最小测试层级：

### 9.1 Product Profile

- schema、深度只读和生产唯一 Profile；
- `dev` 身份确定性派生；
- 新品牌 app ID、协议和目录不复用 BluedCode；
- 环境变量、CLI 和用户配置无法覆盖产品事实。

### 9.2 源码业务边界

- `.config/bluedcode/{config.json,opencode.json,opencode.jsonc}` 的 Provider/model/MCP/plugin 生效；
- 未声明 Provider 不因环境、Auth、OAuth、插件或公共目录出现；
- 管理员 Provider 只读可用，所有写入口无副作用失败；
- share/update/modelsdev/public proxy 零公共网络请求；
- API、直接服务调用和 UI 得到一致策略结果。
- 本地偏好允许图形化写入，外联集成字段和未知字段在统一配置变更策略中拒绝。

### 9.3 UI 与 Desktop

- 默认 V1，设置开关切换 V2 并可持久化；
- Provider 页只展示管理员结果，不显示为可配置供应商；
- CLI、WSL、更新和公开分享入口不可见且直接调用失败；
- dev/prod app ID、Deep Link、AppData、日志和窗口状态互相隔离。
- ProductUiRegistry 注册基础设置与 Provider 只读视图，但不注册外联集成管理、OAuth、分享、更新和公共链接。

### 9.4 构建与产物

- ModuleContract 派生目标无重复、无遗漏；
- server 和 Electron ledger 精确覆盖；
- 根仓只含品牌源资源，子仓独立包含完整构建代码；资源同步摘要一致；
- 构建前后 tracked source 不变；
- ASAR、native、PE、Portable、最终提取树和 manifest exact；
- 静态 locale 与资源品牌正确，保留协议未误换。

### 9.5 Windows 运行验收

- 全新数据目录启动无主进程 JavaScript 错误；
- 加载实际 `.config/bluedcode` 模型并创建会话；
- 重启后不存在失效 session 导致的全局崩溃；
- agent-core 等服务错误保持可诊断且不被构建层掩盖；
- 移动 Portable 后 Deep Link 注册刷新；
- prod 版本显示完整 `<OpenCode版本>-<YYMMDD>-<NN>-<commit>`。

发行验收必须启动最终 Portable EXE，使用隔离用户目录和最小管理员配置，等待 Electron main、本地 server health、preload、renderer 和管理员模型读取全部就绪，再正常退出并确认无残留进程。现有源码 fixture 仅作为快速测试保留，不得替代真实产物门禁。验收状态通道只记录阶段、布尔结果和摘要，不记录敏感配置。

## 10. BluedCode 构建兼容性

- 影响 Desktop 构建依赖图：是，新增 `@foreachcode/product` 并删除多组派生模块。
- 修改品牌规则目标：是，runtime identity 从 adapter 迁入源码，静态 locale 和资源规则保留。
- 新增用户可见产品名称：否，仍只有 BluedCode/BluedCode Dev。
- 影响 CLI、更新、Deep Link 和数据隔离：是，全部从构建钩子迁为源码能力。
- 需要更新当前版本适配器：是，删除已迁移规则并改为 Profile 一致性审计。
- 需要更新通用框架：是，引入跨版本可复用的 Adapter、ModuleContract、ledger、诊断和完整快照能力。

每迁移一项源码行为后都必须运行品牌兼容审计。旧构建规则与新源码同时产生不一致时，构建必须失败，不能选择任一结果继续打包。

## 11. Git 历史设计

实现期间在当前分支之上工作并创建本地安全引用，避免过早破坏可运行基线。全部验收后，从 `v1.18.18` 重建为两条提交：

```text
feat(product): 实现 BluedCode 产品与桌面构建
feat(enterprise): 实现 BluedCode 企业产品策略
```

第一条包含产品包、ORIGIN-01 源码行为、保留的品牌构建和对应规格；第二条只包含 ORIGIN-02 服务策略、企业 UI 与测试。提交不得混入 `.xcode`、失败证据、产物或用户 ignored 文件。

远端更新前必须记录远端旧 HEAD，确认目标分支没有未知新提交，并使用 `--force-with-lease`。根仓随后以中文语义提交更新跨版本规格、品牌源资源摘要和子模块指针，不同步构建代码。

## 12. 完成条件

1. `@foreachcode/product` 成为生产唯一的静态产品事实源。
2. 运行时身份与 ORIGIN-01/02 业务策略不再依赖构建期 AST 改写。
3. `.config/bluedcode` 中兼容配置文件的 Provider 和 model 正常生效。
4. 管理员 Provider 可用但不显示为用户可配置供应商。
5. 服务边界在网络、写入和进程启动前 fail-closed。
6. 构建只保留视觉、静态 locale、发行、缓存与审计职责。
7. server/Electron 转换、Profile 和最终产物具有统一可追溯证据。
8. 根仓不保存构建代码，子仓独立 clone 可构建；根仓与子仓品牌源资源摘要一致。
9. dev 与 prod Portable 均通过静态审计和 Windows 运行验收。
10. Git 历史重整为批准的两条提交并安全更新远端。
11. `ORIGIN-01`、`ORIGIN-02`、`ORIGIN-07` 的矩阵只在全部验收后登记完成提交。
12. 企业业务代码只在配置策略、管理员集成注册、能力服务根和 UI Registry 中实现，不保留逐 handler/逐页面的重复安全判断。
13. 正式 Portable 通过真实启动链路验收，而不仅是源码 fixture。

## 12.1 当前线性历史验收记录

截至提交 `e96d35abe23d09234ebfec1391331f08757e2890`，当前线性历史已经完成源码迁移、构建收敛、兼容审计和最终 Portable 运行验收。

已通过的主要门禁：

- `packages/product`: `bun test test`、`bun typecheck`
- `packages/opencode`: `bun test src/config/product-policy.test.ts src/config/admin-config.test.ts src/provider/product-provider.test.ts src/product/network-policy.test.ts`
- `packages/app`: `bun test --conditions=solid --preload ./happydom.ts src/product src/components src/pages/layout/helpers.test.ts`，结果 `165 pass / 0 fail`
- `xcode/build/bluedcode`: `bun test test`，结果 `206 pass / 0 fail`
- `xcode/build/bluedcode`: `bun run build.ts --channel dev --audit-only`，兼容审计完成

dev Portable：

- 文件：`.xcode/bluedcode/workspaces/dev-70329dfcc2046049/artifacts/c69dcb1479ad5646690b0a7bb1a06c5a7046fd6dabaf8c0dd5c37e3f10b41392/BluedCode-Dev-1.18.18-dev-e96d35abe2-windows-x64-portable.exe`
- SHA-256：`cbc205d70769e9f9776d168ada5a2d62342dc00211f600a3ee133a405cc40a04`
- 可见版本：`1.18.18-dev-e96d35abe2`

prod Portable：

- 文件：`.xcode/bluedcode/workspaces/prod-9f654edab99d2cd2/artifacts/e2ab81551fa9edf67e758046d395e54f2137df4b646bbaa6c97bfb8a1c6131cd/BluedCode-1.18.18-260816-01-e96d35abe2-windows-x64-portable.exe`
- SHA-256：`ac87126ce2c158ea95b6698e800d1f328508227829293ba4a2f73ae996309c4f`
- 可见版本：`1.18.18-260816-01-e96d35abe2`
- 候选 tag：`bluedcode-v1.18.18-260816-01`

两套 manifest 的 runtime evidence 均记录最终 EXE 已启动、本地 server health/preload/renderer 就绪、管理员模型加载成功、无残留进程、`.config/bluedcode` 被读取、公共网络请求为空、默认 V1 且可切换 V2、`auth` / `connect-provider` / `share` / `update` 入口禁用，并将 stale session 恢复为受控 `SESSION_NOT_FOUND`。

已知非本轮阻塞项：

- `packages/opencode bun typecheck` 受既有 `script/build-config.ts(2,40): Cannot find module '@opencode-ai/brand/config'` 影响；
- `packages/app bun typecheck` 与 `packages/desktop bun typecheck` 受既有 `src/custom-elements.d.ts(1,1)/(1,2): TS1128` 影响；
- `packages/desktop bun test src/main src/renderer` 的完整目录运行受当前 Bun/Node 环境缺少 `node:sqlite` 影响，相关非 sqlite 测试可单独通过。

历史重整与远端 force push 尚未执行。若执行历史重整，origin spec 矩阵应记录重整后、重新验收通过的最终提交；否则可将后续文档提交作为当前线性历史的完成落点。

## 13. 非目标

- 不支持同一分支运行时切换 OpenCode/BluedCode。
- 不把 Profile 暴露为普通用户配置。
- 不自动迁移 OpenCode、BluedCode dev/prod 或未来新品牌的数据。
- 不借迁移机会修复未经确认的 OpenCode 上游业务缺陷。
- 不把 1.18.18 的路径和指纹放入通用构建框架。
- 不在本规格中引入 macOS、Linux、ARM64、安装器、签名或自动发布。
