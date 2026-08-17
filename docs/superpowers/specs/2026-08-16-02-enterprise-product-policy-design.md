# OpenCode 1.18.18 BluedCode 企业内部化构建设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/02-enterprise-product-policy.md`（`ORIGIN-02`）
- 依赖：`ORIGIN-01` / `opencode/docs/superpowers/specs/2026-08-15-01-product-branding-design.md`
- 目标基线：OpenCode tag `v1.18.18`
- 基线提交：`31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`
- 当前实现分支：`dev-foreachcode-1.18.18`
- 当前品牌构建提交：`660847828022c043a5c3d6bc90bd54070b0d8b13`
- 目标平台：Windows x64
- 目标产物：单文件免安装 Portable EXE
- 状态：历史实现，待迁移到 `2026-08-16-03-product-profile-architecture-design.md`

> 本文保留企业策略构建期派生方案的历史设计与验证证据。Provider、配置写入、分享、更新和公共网络策略将迁移到源码服务边界；本文中的非侵入实现限制不再作为当前交付合同。

## 1. 实现目标

在不修改 OpenCode 1.18.18 上游受跟踪源码的前提下，把 BluedCode Desktop 构建为企业内部发行。企业内部发行必须默认拒绝产品自身发起的公共服务连接，并把 Provider、模型、凭据和外部能力的启用权收束到管理员静态配置。

本设计只允许修改 `opencode/xcode/build/bluedcode/**` 下的构建框架、版本适配器、测试和规格文档。`packages/**`、`packages/desktop/**`、`packages/app/**`、`packages/opencode/**`、lockfile、现有 workspace 配置和 `node_modules` 均作为只读上游输入。最终产物行为通过构建期派生源码、虚拟模块、环境白名单和打包审计实现。

如果实现过程中发现某项企业策略无法在该边界内完成，必须停止并重新评审，不能直接修改上游源码补洞。

## 2. 非侵入边界

### 2.1 禁止

- 提交对上游源码目录的业务修改；
- 修改 `bun.lock`、`package.json`、workspace 配置或依赖安装结果；
- 通过全局字符串替换改变整棵源码；
- 在运行时依赖父级根仓、绝对开发机路径或未跟踪补丁；
- 用仅隐藏 UI 的方式替代 server/runtime 边界拒绝；
- 把普通用户可改的配置、环境变量或客户端状态作为关闭企业策略的开关。

### 2.2 允许

- 在 `xcode/build/bluedcode/common/**` 增加可复用的企业策略转换与审计能力；
- 在 `xcode/build/bluedcode/version/1.18.18/**` 增加 1.18.18 专用规则、指纹和 AST 钩子；
- 构建时把受控上游模块派生到 `.xcode/bluedcode/**`；
- 在 Electron Vite/Rollup pre-transform 阶段替换受控模块；
- 对最终 bundle、ASAR、Portable EXE 和 manifest 做 fail-closed 审计；
- 在 `brand.json` 或企业策略配置中声明管理员静态 Provider 配置入口，但该配置必须被构建脚本和产物共同校验。

## 3. 1.18.18 相关源码现状

### 3.1 Provider 与模型

1.18.18 的 Provider 列表主要来自：

- `packages/opencode/src/provider/provider.ts`：合并 `ModelsDev` 公共模型目录、配置 Provider、环境变量凭据、Auth 凭据、插件 hooks 和自定义 Provider；
- `packages/opencode/src/provider/auth.ts`：暴露 Provider OAuth/API key 方法、授权和回调写入；
- `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts` 与 `handlers/provider.ts`：提供 `/provider`、`/provider/auth`、`/provider/:providerID/oauth/authorize`、`/provider/:providerID/oauth/callback`；
- `packages/app/src/hooks/use-providers.ts` 与 `provider-catalog.ts`：把 server Provider 结果投射成连接、推荐和模型选择数据；
- `packages/app/src/components/settings-providers.tsx` 与 `settings-v2/providers.tsx`：提供连接、断开、自定义 Provider 和热门 Provider 入口；
- `packages/app/src/components/dialog-connect-provider.tsx`、`dialog-custom-provider.tsx`、`dialog-manage-models.tsx`、`dialog-select-model*.tsx`：提供连接、手工 Provider 和模型管理体验。

默认上游行为会把公共目录、环境变量、Auth 存储、插件 OAuth、custom provider 与远程模型刷新合并为可用 Provider。企业发行必须改为只信任管理员静态配置。

### 3.2 公开分享

1.18.18 的公开分享入口主要来自：

- `packages/opencode/src/share/session.ts`：`share()` 调用 `ShareNext.create()` 后写入 session share URL，`create()` 还会按 `autoShare` 或 `config.share === "auto"` 自动分享；
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`：暴露 session share/unshare HTTP API；
- `packages/app/src/pages/session/timeline/message-timeline.tsx`：展示发布、取消发布和分享状态操作。

企业发行必须让创建公开分享、自动分享和取消公开分享在服务边界 fail-closed。允许读取外部用户明确提供的分享 URL 的需求不在本轮 Desktop 构建目标内扩大实现。

### 3.3 更新、遥测和公共入口

1.18.18 Desktop 当前存在：

- `packages/desktop/src/main/index.ts`、`updater.ts`、`ipc.ts`、`preload/index.ts`、`renderer/index.tsx` 中的 updater 初始化、订阅、检查和安装入口；
- `packages/app/src/components/settings-general.tsx` 与 `settings-v2/general.tsx` 中的更新设置行；
- `packages/app/src/components/titlebar.tsx` 中的更新提示；
- `packages/app/src/entry.tsx`、`app.tsx`、`packages/desktop/src/renderer/index.tsx` 和 `packages/app/vite.config.ts` 中的 Sentry 初始化或构建插件；
- `packages/app/src/context/highlights.tsx` 中的公共 changelog URL；
- `packages/app/src/desktop-menu.ts` 中的反馈、GitHub issue 等公共产品入口；
- `packages/desktop/electron-builder.config.ts`、`scripts/finalize-latest-*.ts` 等上游发布与更新配置。

`ORIGIN-01` 已经在 BluedCode 构建中关闭 publish、updater、Sentry 和非 Desktop 入口。本规格要把它升级为企业策略合同：这些能力不仅不参与打包，还要在最终产物审计中作为受限公共能力检查。

## 4. 企业策略模型

新增构建态企业策略配置，作为 BluedCode 1.18.18 版本适配器的一部分。建议形态：

```text
xcode/build/bluedcode/version/1.18.18/enterprise/
├── policy.ts
├── provider-rules.ts
├── share-rules.ts
├── public-surface-rules.ts
└── tests/
```

策略必须包含：

- `enabled: true`：企业内部化对 BluedCode Desktop 固定启用；
- `providerMode: "admin-static-only"`：只允许管理员静态配置 Provider；
- `blockedAuthWrites: true`：禁止普通用户写入 Provider 凭据；
- `blockedPublicShare: true`：禁止公开分享和自动分享；
- `blockedPublicCatalogRefresh: true`：禁止公共模型目录远程刷新；
- `blockedTelemetry: true`：禁止 Sentry、公共 trace exporter 和远程诊断凭据；
- `blockedPublicUpdates: true`：禁止公共更新检查、下载和安装；
- `blockedPublicProductLinks: true`：禁止反馈、上游 changelog、GitHub issue、公共 Console 等入口。

该策略不是用户配置项，不允许由命令行参数、环境变量、LocalStorage、server config 或 HTTP API 关闭。

## 5. Provider 管控设计

### 5.1 服务边界

构建适配器必须把 Provider 服务收束为管理员静态配置：

1. `/provider` 返回值只能包含静态配置中声明且解析成功的 Provider；
2. `connected` 只表示管理员配置后可用的 Provider，不把环境变量、Auth 存储、账户或插件 OAuth 视作连接；
3. `default` 只从静态 Provider 模型中派生；
4. `/provider/auth` 返回空方法集合；
5. `/provider/:providerID/oauth/authorize` 与 `/provider/:providerID/oauth/callback` 在读取/写入凭据、启动本地 OAuth server 或发出网络请求前失败；
6. `auth.set`、`auth.remove`、插件 `auth` hook 和公共 OAuth flow 不得因 UI 绕过而写入 Provider 凭据；
7. `ModelsDev` 公共目录可以作为构建时或本地离线解析来源，但运行时不得因网络、环境变量或自动发现把未声明 Provider 加入结果。

管理员静态配置的初始读取方案在实现计划中进一步定点：优先复用上游 `config.provider` 的受控子集，但必须明确拒绝 `source: "env"`、OAuth、well-known remote config 和自动发现。若需要新增 BluedCode 专属离线配置文件，该文件必须位于当前 channel 的受信数据边界或随包只读资源中，并通过 schema 校验。

### 5.2 UI 边界

构建适配器必须隐藏或禁用普通用户新增 Provider 的入口：

- Provider 设置页只显示管理员配置后可用的 Provider；
- 不显示热门 Provider、连接 Provider、自定义 Provider、OAuth、API key 写入和断开按钮；
- 模型选择器仍可选择管理员提供的模型；
- 模型管理页只能查看管理员模型，不允许新增或写凭据；
- UI 状态陈旧或用户通过 DevTools 调用原函数时，server 边界仍必须拒绝。

## 6. 分享设计

构建适配器必须在服务边界禁止公开分享：

- `SessionShare.share()` 在调用 `ShareNext.create()` 前失败；
- `SessionShare.unshare()` 不向公共服务发送请求，且对未分享 session 可安全返回；
- `SessionShare.create()` 忽略 `autoShare` 和 `config.share === "auto"`；
- session HTTP API 的 share/unshare endpoint 必须返回稳定企业策略错误；
- renderer 中发布、取消发布、复制公开链接、公开分享状态提示不可见；
- 最终产物中不得包含可由用户触发的公开分享 URL 创建路径。

本轮不实现企业内部分享源。未来如需内部分享，必须另写 origin/version spec，明确 endpoint、凭据、字段白名单和管理员开关。

## 7. 更新、遥测与公共入口设计

### 7.1 更新

企业发行继续沿用 `ORIGIN-01` 的无 updater 策略，并补充以下合同：

- main 进程不调用 `setupAutoUpdater()`、`updater.start()`、定时 `updater.check()`；
- preload 不暴露可执行 updater check/install API，或暴露但永远返回 disabled；
- renderer 更新设置行、titlebar 更新提示和菜单检查更新入口不可见；
- Electron Builder publish 配置保持 `null` / `never`；
- 最终产物扫描不得出现 anomalyco/OpenCode 更新仓库、latest.yml/latest.json 公共更新路径或可执行更新 IPC。

### 7.2 遥测

企业发行必须清空公共遥测：

- 构建环境不转发 Sentry DSN、auth token、org、project、release；
- renderer 不初始化 Sentry，或初始化入口被构建态替换为 no-op；
- App Vite 不加载 Sentry 上传插件；
- server 子进程不继承 `SENTRY_*`、`OTEL_*`、公共 trace/exporter 凭据；
- 本地日志继续可用，且只写当前 BluedCode channel 的本地日志链路。

### 7.3 公共产品入口

构建适配器必须移除或中和：

- 上游 changelog 请求；
- 反馈、GitHub issue、上游 Console、公共 Web 或公开站点跳转；
- 任何会打开 `opencode.ai`、`github.com/anomalyco` 或公共发布仓库的用户入口。

允许保留纯内部协议、代码注释、包名、license、OAuth 服务身份白名单，但必须进入审计 allowlist。

## 8. 构建实现方式

本规格复用 `ORIGIN-01` 已建立的非侵入构建框架：

1. 在 1.18.18 adapter 中新增企业策略受控文件指纹；
2. 对 server/provider/share/config/auth 相关模块使用 TypeScript AST 钩子生成派生模块；
3. 对 renderer/settings/share/update/highlight/menu 相关模块使用声明式规则或 AST 钩子隐藏入口；
4. 对 Electron main/preload/updater/Sentry 相关模块使用版本钩子中和运行时入口；
5. 对公共 URL、公共 endpoint、OAuth 方法、auth 写入、share 写入、update IPC 和 telemetry env 增加最终 bundle 审计；
6. 所有派生文件只写入 `.xcode/bluedcode/**`，不回写上游源码；
7. 转换 ledger 记录每个受控模块、规则 ID、命中次数、前后摘要和保留原因。

如果普通声明式规则无法安全表达某个结构变化，必须放入 `version/1.18.18/enterprise/**` 的版本专用钩子，而不是扩展无边界字符串替换。

## 9. Fail-closed 规则

以下情况必须在打包前失败：

- 受控上游模块指纹与 `v1.18.18` 不匹配；
- Provider/auth/share/update/Sentry 入口零命中、重复命中或结构变化；
- 新增未分类公共 URL、OAuth endpoint、更新 endpoint、Sentry/OTEL 变量、分享 endpoint；
- 企业策略配置缺失、schema 无效或尝试由用户配置关闭；
- 管理员 Provider 配置包含未知 source、OAuth、环境变量凭据或远程 well-known；
- 最终 bundle 中仍有可由 UI 或 HTTP API 触发的受限操作；
- 构建过程修改 Git 跟踪文件。

运行时直接调用旧 HTTP API 或 preload API 时也必须稳定失败，并且失败发生在网络请求和状态写入之前。

## 10. 测试设计

### 10.1 版本适配器测试

- 在 `v1.18.18` 受控源码上精确命中 Provider/auth/share/update/telemetry/UI 入口；
- 删除、复制或改写任一受控入口时 fail-closed；
- 未声明的新公共 URL 或 OAuth endpoint 出现时 fail-closed；
- 环境变量注入 OpenAI、Anthropic、AWS、Google、Cloudflare、Snowflake 等常见 Provider 凭据时，未声明 Provider 不出现在 `/provider`；
- 静态管理员 Provider 能出现在 `/provider`、模型选择器和默认模型结果中；
- `/provider/auth` 返回空方法集合；
- authorize/callback 被直接调用时不启动 OAuth、不写入 Auth、不发送请求；
- share/unshare 直接调用时不调用 `ShareNext`，不写 session share URL；
- updater/Sentry/changelog/feedback 入口从 Desktop 构建图中不可达。

### 10.2 构建框架测试

- 企业策略配置 schema、默认启用和不可被用户参数关闭；
- TypeScript AST 钩子只处理声明节点；
- 转换 ledger 包含企业策略规则；
- 最终 bundle 扫描公共 endpoint 与受限 API；
- server 子进程环境白名单不包含公共遥测和发布凭据；
- ASAR 与 Portable EXE 审计记录企业策略结果。

### 10.3 运行验收

- 使用全新临时 AppData/LocalAppData 启动 prod Portable；
- 注入常见 Provider 环境变量，UI 和 `/provider` 仍只显示管理员静态 Provider；
- 点击或直接调用 Provider 连接、OAuth、custom provider、分享、更新均失败且无网络副作用；
- 模型选择和会话创建可使用管理员模型；
- 本地日志可写入当前 channel；
- 启动期间无 Sentry、公共更新、公共 changelog、分享创建请求；
- 窗口仍显示 BluedCode 品牌，默认 V1/V2 切换等 `ORIGIN-01` 验收不回退。

## 11. BluedCode 构建兼容性

- 影响 Desktop 构建依赖图：是。Provider、share、updater、Sentry、settings 和 session timeline 相关模块会进入受控转换集合。
- 修改品牌规则目标文件或语义节点：可能。新增企业规则不得改变 `ORIGIN-01` 已验证的品牌身份节点；如果模块重叠，必须合并 ledger 并重新跑品牌审计。
- 新增用户可见产品名称：否。本规格不新增品牌名，只新增企业策略行为和错误文案。
- 影响 CLI 入口剔除：间接影响。企业策略不能重新引入 CLI/Web/TUI 入口，最终审计继续沿用 `ORIGIN-01` 禁用面。
- 影响更新禁用：是。更新从品牌规格中的“排除项”升级为企业策略必验项。
- 影响 Deep Link：否。继续沿用 `ORIGIN-01` 的 `bluedcode://` 和 `bluedcode-dev://`。
- 影响数据隔离：是。Provider/Auth/share 状态不得写入 OpenCode 数据目录，也不得因历史凭据跨产品加载。
- 需要更新当前版本适配器：是，新增 1.18.18 企业规则、指纹和测试。
- 需要扩展通用构建框架：仅当公共 endpoint 审计、网络副作用审计或企业策略 schema 能被后续版本复用时才扩展；否则留在 1.18.18 专用目录。

企业规格完成前，必须重新运行 `ORIGIN-01` 品牌兼容审计和 Windows x64 Portable 构建验收。

## 12. 非目标

- 不实现企业内部 Provider 分发服务；
- 不实现企业内部分享；
- 不实现企业内部更新源；
- 不实现企业遥测平台；
- 不改造 OpenCode 上游为可配置企业版；
- 不支持 CLI、Web、TUI、macOS、Linux 或 ARM64；
- 不要求删除上游源码，只要求 BluedCode Desktop 企业产物无法触发受限能力。

## 13. 完成条件

1. 企业内部化实现没有修改上游受跟踪源码、lockfile、workspace 配置或依赖安装结果。
2. 1.18.18 企业规则在受控源码上精确命中，结构变化会 fail-closed。
3. 未声明 Provider 不会因环境变量、Auth 存储、OAuth、well-known、插件 hook 或公共目录进入可用列表。
4. 管理员静态 Provider 和模型可以正常选择并发起会话。
5. Provider 凭据写入、OAuth、custom provider、公开分享、更新、Sentry、公共 changelog 和反馈入口均不可由 UI 或 API 触发。
6. 最终 bundle、ASAR、Portable EXE 和 manifest 包含企业策略审计结果。
7. `ORIGIN-01` 品牌、默认 V1 布局、Windows x64 Portable、版本号和数据隔离验收不回退。
8. prod 包可启动，且启动期间没有 JavaScript 主进程错误。
9. 父级 origin spec 的版本实现矩阵只在上述验收完成后更新。

## 14. 1.18.18 实施结果

- 企业构建实现提交：`a079142eff78d89655d9a9562377e35544f596df`；类型检查修复提交：`4536926da7f2e9ea05f6778011a15c9670fd89e0`。
- RED：`bun test test/build.test.ts -t "企业|公共能力审计|manifest"` 在新增 `method.authorize(` 用例后失败；GREEN：加入企业输出审计 token 后同一命令 6/6 通过。
- 全量验证：`bun test test version/1.18.18/tests` 188/188 通过；`bun test test/typecheck.test.ts` 通过。`bunx oxlint common version/1.18.18 test build.ts` 仍受根 `.oxlintrc.json` 中不被当前 oxlint 接受的 `options.typeAware` 配置阻断。变更文件的 Prettier 检查通过；计划文件在本轮前已不符合 Prettier，未作无关格式化重写。
- dev Portable：`BluedCode-Dev-1.18.18-dev-4536926da7-windows-x64-portable.exe`，大小 `166,168,001` bytes，SHA-256 `c1bd30df7546da9e5a7b4d46052ec9204dac819a7d5d866f318c721c9fc3f6f7`。发行 manifest 记录 `providerMode: "admin-static-only"`、企业与输出审计均通过、未分类输出项为空、转换 ledger 为 108 条记录，并认证构建前后 tracked source 同为类型检查修复提交。
- 最终审查修复提交：`4635e10e1f4a77b0cbb4bd950069e3dfdb9ef91f`。管理员 Provider 信任边界固定为 `C:\ProgramData\BluedCode` 托管配置，Provider 直接模型路径与列表共用净化状态，`PATCH /global/config` 在读取请求体或写配置前返回禁用错误；ModelsDev 仅保留编译期离线快照，运行时公网刷新与 `OPENCODE_MODELS_URL` 被移除；OTEL 环境变量按大小写无关规则过滤；`/global/upgrade` 在安装检测、网络和进程调用前失败；Desktop 反馈及 server 公共 UI 代理入口被移除并纳入输出审计。
- 最终审查 TDD：五组聚焦用例初始 5/6 失败，实施后 6/6 通过；随后增加 direct model、固定 `ProgramData` 权限边界及 fail-closed 变异用例，适配器与 fail-closed 套件最终 32/32 通过。真实 compile smoke 3/3 通过，类型检查通过。全量 `bun test test version/1.18.18/tests` 最终为 194/194 通过，1464 个断言、17 个文件。
- 最终审查 dev Portable：`BluedCode-Dev-1.18.18-dev-4635e10e1f-windows-x64-portable.exe`，大小 `166,165,839` bytes，SHA-256 `9d7955ba592d3d00ccb35068fb6dce4216d92f39fada1c2ee70cd39c75d6c599`。发行 manifest 记录 `providerMode: "admin-static-only"`、企业与输出审计均通过、未分类输出项为空、转换 ledger 为 111 条记录，并认证构建前后 tracked source 同为最终审查修复提交。
- 未运行 prod 打包或 prod 启动验收；它们不在本任务授权范围内。父级 origin spec 的版本实现矩阵因此保持不变。
