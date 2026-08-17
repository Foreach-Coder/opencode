# BluedCode 产品 Profile 可持续性收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 BluedCode 的产品身份、企业安全策略和构建适配收敛成可长期演进的混合架构：运行时业务差异进源码根边界，构建层只负责资源、发行、版本适配和最终审计。

**Architecture:** `@foreachcode/product` 是唯一静态产品事实源；`packages/opencode`、`packages/app`、`packages/desktop` 在天然根边界读取 Profile 和操作矩阵。`opencode/xcode/build/bluedcode` 通过通用 `VersionAdapter` registry 选择版本适配器，保留品牌资源、locale、打包和最终产物审计，不再做企业业务 AST 改写。

**Tech Stack:** Bun 1.3.14、TypeScript、Effect、Solid、Electron 42.3.3、electron-vite 5、electron-builder 26.15.2、Windows x64 Portable。

**Spec:** `docs/superpowers/specs/2026-08-16-03-product-profile-architecture-design.md`

## Global Constraints

- 目标基线：OpenCode tag `v1.18.18`，基线提交 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`。
- 目标平台：Windows x64 Desktop；只构建单文件免安装 Portable EXE。
- BluedCode 分支只构建 BluedCode，不支持运行时切换回 OpenCode。
- 未来改品牌必须定义新的完整 Product Profile，并同步改变 app ID、协议、配置、缓存、日志、窗口状态和发行身份。
- 配置目录必须保持 OpenCode 原始布局规则，只把目录段替换为 `.config/bluedcode`；继续识别 `config.json`、`opencode.json` 和 `opencode.jsonc`。
- Provider、model、MCP、插件、远程配置和凭据只能来自管理员静态配置；项目配置、环境变量、GUI 和 API 不能新增或修改外联集成。
- 主题、语言、字体、快捷键、通知、V1/V2 布局和无外联副作用的本地偏好必须继续支持图形化配置。
- 企业能力必须收口到配置变更策略、管理员集成快照、Provider/MCP/插件注册表、Auth、分享、公共目录、遥测、更新、公共代理和 UI Registry；不得逐 handler、逐页面重复散布安全判断。
- 构建不得改写受跟踪源码、lockfile 或 `node_modules`。
- 根仓不保存 TypeScript、JavaScript 或脚本构建代码；构建代码只允许存在于 `opencode/xcode/build/bluedcode`。
- 所有 commit 摘要与正文必须使用中文。

---

## File Structure

- `packages/product/src/profile.ts`：唯一生产 Profile、操作矩阵、Profile 摘要和深度只读合同。
- `packages/product/src/capability.ts`：`authorize(profile, operation)` 与派生能力视图。
- `packages/product/src/identity.ts`：`deriveChannelIdentity(profile, channel)`，覆盖 app ID、协议、目录、发行名和可见版本。
- `packages/product/src/error.ts`：稳定产品错误码和安全错误消息。
- `packages/opencode/src/config/product-policy.ts`：统一配置变更策略，允许本地偏好，拒绝外联集成和未知字段。
- `packages/opencode/src/config/admin-config.ts`：管理员静态集成快照，只从 `Global.Path.config` 和 OS managed config 读取。
- `packages/opencode/src/provider/provider.ts`：Provider/model 只读管理员快照和公共目录禁用根边界。
- `packages/opencode/src/provider/auth.ts`、`packages/opencode/src/auth/index.ts`：Auth/API key 写入口统一拒绝。
- `packages/opencode/src/mcp/index.ts`、`packages/opencode/src/plugin/index.ts`：MCP/插件注册表只接受管理员静态来源。
- `packages/opencode/src/share/*`、`packages/opencode/src/installation/index.ts`、`packages/opencode/src/server/shared/ui.ts`：分享、更新、公共代理根服务拒绝。
- `packages/opencode/src/product/policy.ts`、`http-policy.ts`、`network-policy.ts`、`provider-policy.ts`：收敛为 Profile operation 的薄适配层。
- `packages/app/src/product/ui-registry.ts`：统一 UI surface 注册表。
- `packages/app/src/product/capabilities.ts`：兼容旧调用的薄封装，调用 `ProductUiRegistry`。
- `packages/app/src/components/settings-providers.tsx`、`settings-v2/providers.tsx`、`dialog-select-model*.tsx`、`dialog-custom-provider.tsx`：只展示管理员静态 Provider，不展示用户连接/配置入口。
- `packages/desktop/src/main/product-identity.ts`、`product-capability.ts`、`index.ts`、`initialization.ts`：运行时 identity、Deep Link、userData、版本显示和 Desktop-only 能力。
- `xcode/build/bluedcode/common/adapter.ts`：通用 `VersionAdapter`、`ModuleContract`、registry 类型和派生函数。
- `xcode/build/bluedcode/version/1.18.18/index.ts`：只保留 1.18.18 的基线、locale、静态资源和输出审计，不包含企业业务 rewrite。
- `xcode/build/bluedcode/common/{server,plugins,manifest,build}.ts`：通过 registry 接收 adapter，不 import `adapter11818`。
- `xcode/build/bluedcode/common/runtime-acceptance.ts`：真实最终 Portable EXE 启动验收。
- `xcode/build/bluedcode/tools/{prepare-version.ts,adapter-diff.ts}`：只读候选生成与差异报告。
- 根仓 `xcode/build/bluedcode/`：只保留 `brand.json`、`app-icon.svg`、`app-icon.png`、`wordmark.svg`、资源摘要文件；删除所有 `common/**/*.ts`、`snapshot-manifest.json` 和 `tui.json`。

---

### Task 1: Product Profile 单一事实源

**Files:**

- Modify: `packages/product/src/profile.ts`
- Modify: `packages/product/src/capability.ts`
- Modify: `packages/product/src/identity.ts`
- Modify: `packages/product/src/error.ts`
- Modify: `packages/product/src/index.ts`
- Test: `packages/product/test/profile.test.ts`
- Test: `packages/product/test/capability.test.ts`
- Test: `packages/product/test/error.test.ts`

**Interfaces:**

- Produces: `Product.profile`, `Product.profileDigest(profile)`, `Product.authorize(profile, operation)`, `Product.deriveChannelIdentity(profile, channel)`, `Product.localPreferenceKeys`.
- Consumes: existing `@foreachcode/product` package and current BluedCode constants.

- [ ] **Step 1: Write Profile operation RED tests**

Add tests that require these exact operations:

```ts
expect(Product.profile.operations).toEqual({
  "config.write.preference": "allow",
  "config.write.integration": "deny",
  "provider.read": "allow-admin-static",
  "provider.manage": "deny",
  "auth.manage": "deny",
  "mcp.manage": "deny",
  "plugin.manage": "deny",
  "share.public": "deny",
  "catalog.public": "deny",
  telemetry: "deny",
  "update.public": "deny",
  "proxy.public": "deny",
})
expect(Product.localPreferenceKeys).toEqual([
  "theme",
  "language",
  "font",
  "keybinds",
  "notifications",
  "newLayoutDesigns",
])
```

- [ ] **Step 2: Run RED**

Run from `packages/product`:

```bash
bun test test/profile.test.ts test/capability.test.ts test/error.test.ts
```

Expected: FAIL because `operations`, `profileDigest`, `authorize`, or `localPreferenceKeys` is missing.

- [ ] **Step 3: Implement minimal Profile contract**

Extend `ProductProfile` with `operations` and `localPreferences`. Implement:

```ts
export function authorize(profile: ProductProfile, operation: ProductOperation) {
  const decision = profile.operations[operation]
  if (decision === "allow" || decision === "allow-admin-static") return { decision }
  throw new ProductError(errorCodeForOperation(operation), messageForOperation(operation))
}
```

`profileDigest` must JSON-stabilize the profile without reading environment variables, CLI args, or user config.

- [ ] **Step 4: Run GREEN**

Run:

```bash
bun test test/profile.test.ts test/capability.test.ts test/error.test.ts
bun typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/product
git commit -m "feat(product): 收敛产品 Profile 操作矩阵"
```

---

### Task 2: 配置根边界与管理员静态快照

**Files:**

- Create: `packages/opencode/src/config/product-policy.ts`
- Create: `packages/opencode/src/config/admin-config.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/product/policy.ts`
- Test: `packages/opencode/src/config/product-policy.test.ts`
- Test: `packages/opencode/src/config/admin-config.test.ts`
- Test: `packages/opencode/src/product/policy.test.ts`

**Interfaces:**

- Consumes: `Product.authorize`, `Product.localPreferenceKeys`.
- Produces: `ProductConfigPolicy.classifyWrite(payload)`, `ProductConfigPolicy.requireWrite(payload)`, `AdminConfig.load(info)`, `Config.getAdminIntegrations()`.

- [ ] **Step 1: Write RED tests for config write classification**

Add cases:

```ts
expect(ProductConfigPolicy.classifyWrite({ theme: "dark" })).toEqual({ kind: "preference", allowed: true })
expect(() => ProductConfigPolicy.requireWrite({ provider: { openai: {} } })).toThrow("CONFIG_WRITE_DISABLED")
expect(() => ProductConfigPolicy.requireWrite({ mcp: { local: {} } })).toThrow("CONFIG_WRITE_DISABLED")
expect(() => ProductConfigPolicy.requireWrite({ plugin: ["./plugin.ts"] })).toThrow("CONFIG_WRITE_DISABLED")
expect(() => ProductConfigPolicy.requireWrite({ unknown_field: true })).toThrow("CONFIG_WRITE_DISABLED")
```

- [ ] **Step 2: Write RED tests for admin snapshot isolation**

Create fixture `Info` objects proving:

```ts
const admin = AdminConfig.fromSources({
  globalConfig: { provider: { "openai-proxy": provider }, model: "openai-proxy/gpt-4.1" },
  envConfig: { provider: { attacker: provider }, model: "attacker/gpt" },
  projectConfig: { provider: { project: provider }, mcp: { leak: {} } },
})
expect(admin.providers.map((item) => item.id)).toEqual(["openai-proxy"])
expect(admin.model).toBe("openai-proxy/gpt-4.1")
```

- [ ] **Step 3: Run RED**

Run from `packages/opencode`:

```bash
bun test src/config/product-policy.test.ts src/config/admin-config.test.ts src/product/policy.test.ts
```

Expected: FAIL because the new modules are missing or current `Config.update` rejects all writes.

- [ ] **Step 4: Implement root policy**

Move config-write decisions into `product-policy.ts`. `Config.update` and `Config.updateGlobal` must call `ProductConfigPolicy.requireWrite` before merging or persisting. Only allow keys in `Product.localPreferenceKeys`.

- [ ] **Step 5: Wire admin snapshot**

Keep current `.config/bluedcode/{config.json,opencode.json,opencode.jsonc}` compatibility. `admin-config.ts` must read only trusted global/managed sources, with no `OPENCODE_CONFIG_CONTENT`, env substitution, project override, plugin auto-discovery, OAuth or Auth store.

- [ ] **Step 6: Run GREEN**

Run:

```bash
bun test src/config/product-policy.test.ts src/config/admin-config.test.ts src/product/policy.test.ts
bun typecheck
```

Expected: PASS or fail only with an already documented unrelated upstream typecheck issue; record exact error if unrelated.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/config packages/opencode/src/product
git commit -m "feat(opencode): 收敛配置写入与管理员静态快照"
```

---

### Task 3: Provider、MCP、插件根注册表

**Files:**

- Modify: `packages/opencode/src/provider/provider.ts`
- Modify: `packages/opencode/src/provider/auth.ts`
- Modify: `packages/opencode/src/auth/index.ts`
- Modify: `packages/opencode/src/mcp/index.ts`
- Modify: `packages/opencode/src/plugin/index.ts`
- Test: `packages/opencode/src/provider/product-provider.test.ts`
- Test: `packages/opencode/src/mcp/product-mcp.test.ts`
- Test: `packages/opencode/src/plugin/product-plugin.test.ts`

**Interfaces:**

- Consumes: `Config.getAdminIntegrations()`, `Product.authorize`.
- Produces: `Provider.list()` returns only admin configured providers, each marked `{ managedBy: "admin", configurableByUser: false }`; MCP/plugin loaders consume only admin snapshot.

- [ ] **Step 1: Write RED tests for Provider source isolation**

Test that environment keys, Auth store, OAuth and public catalog do not create providers:

```ts
expect(await providerIDs({ env: { OPENAI_API_KEY: "secret" }, admin: {} })).toEqual([])
expect(await providerIDs({ admin: { provider: { "openai-proxy": providerConfig } } })).toEqual(["openai-proxy"])
expect(await providerPublicInfo("openai-proxy")).toMatchObject({ managedBy: "admin", configurableByUser: false })
```

- [ ] **Step 2: Write RED tests for MCP/plugin admin-only**

Test that `OPENCODE_CONFIG_CONTENT`, project config and auto-discovered `.opencode/plugin` entries do not enter the runtime registry, while admin global config does.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test src/provider/product-provider.test.ts src/mcp/product-mcp.test.ts src/plugin/product-plugin.test.ts
```

Expected: FAIL where current code still merges non-admin sources or lacks admin metadata.

- [ ] **Step 4: Implement registry root checks**

Change Provider, MCP and Plugin service initialization to read integration data from `Config.getAdminIntegrations()` only. Keep model resolution and actual admin Provider invocation working.

- [ ] **Step 5: Keep write roots rejected**

Ensure `ProviderAuth.authorize`, `ProviderAuth.callback`, `Auth.set`, `Auth.remove` call `Product.authorize(..., "auth.manage")` or `"provider.manage"` before reading sensitive request data or writing files.

- [ ] **Step 6: Run GREEN**

Run:

```bash
bun test src/provider/product-provider.test.ts src/mcp/product-mcp.test.ts src/plugin/product-plugin.test.ts
bun test src/config/admin-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/provider packages/opencode/src/auth packages/opencode/src/mcp packages/opencode/src/plugin
git commit -m "feat(opencode): 限定集成注册表为管理员静态来源"
```

---

### Task 4: 公共副作用服务根边界

**Files:**

- Modify: `packages/opencode/src/share/share-next.ts`
- Modify: `packages/opencode/src/share/session.ts`
- Modify: `packages/opencode/src/installation/index.ts`
- Modify: `packages/opencode/src/server/shared/ui.ts`
- Modify: `packages/opencode/src/product/network-policy.ts`
- Modify: `packages/opencode/src/product/http-policy.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/{control,config,global,provider,session}.ts`
- Test: `packages/opencode/src/product/network-policy.test.ts`
- Test: `packages/opencode/src/server/routes/instance/httpapi/product-policy.test.ts`

**Interfaces:**

- Consumes: `Product.authorize`.
- Produces: service-root policy errors converted by `ProductHttpPolicy.reject`.

- [ ] **Step 1: Write RED tests for zero side effects**

Add counter-backed tests:

```ts
await expect(ShareService.create({ request: networkCounter })).rejects.toMatchObject({ code: "PUBLIC_SHARE_DISABLED" })
expect(networkCounter.calls).toBe(0)
await expect(UpdateService.check({ request: networkCounter })).rejects.toMatchObject({ code: "PUBLIC_UPDATE_DISABLED" })
expect(networkCounter.calls).toBe(0)
```

- [ ] **Step 2: Write RED tests proving handlers are thin**

For HTTP handlers, call API routes for Provider/Auth/share/update and assert they all return the same Product error shape without each handler parsing sensitive body fields first.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test src/product/network-policy.test.ts src/server/routes/instance/httpapi/product-policy.test.ts
```

Expected: FAIL where handler-level guards still duplicate policy or service roots are not directly covered.

- [ ] **Step 4: Move checks into service roots**

Keep handlers focused on API shape and error translation. Delete duplicate `ProductPolicy.reject...` branches from handlers when the corresponding service root now rejects the operation.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test src/product/network-policy.test.ts src/server/routes/instance/httpapi/product-policy.test.ts
bun test src/config/product-policy.test.ts src/provider/product-provider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/share packages/opencode/src/installation packages/opencode/src/server packages/opencode/src/product
git commit -m "feat(opencode): 在公共副作用服务根禁用外发能力"
```

---

### Task 5: Product UI Registry 与本地偏好保留

**Files:**

- Create: `packages/app/src/product/ui-registry.ts`
- Modify: `packages/app/src/product/capabilities.ts`
- Modify: `packages/app/src/components/settings-providers.tsx`
- Modify: `packages/app/src/components/settings-v2/providers.tsx`
- Modify: `packages/app/src/components/dialog-select-model.tsx`
- Modify: `packages/app/src/components/dialog-select-model-unpaid.tsx`
- Modify: `packages/app/src/components/dialog-select-model-unpaid-v2.tsx`
- Modify: `packages/app/src/components/dialog-custom-provider.tsx`
- Modify: `packages/app/src/components/settings-general.tsx`
- Modify: `packages/app/src/components/settings-v2/general.tsx`
- Test: `packages/app/src/product/ui-registry.test.ts`
- Test: `packages/app/src/product/ui-surface.test.ts`

**Interfaces:**

- Consumes: `Product.profile.operations`.
- Produces: `ProductUiRegistry.surface(profile)` and `ProductCapabilities` compatibility wrapper.

- [ ] **Step 1: Write RED tests for UI registry**

Assert:

```ts
expect(ProductUiRegistry.surface(Product.profile)).toMatchObject({
  settings: { general: true, providers: "readonly-admin", updates: false },
  providerActions: { connect: false, configure: false, disconnect: false },
  localPreferences: { theme: true, language: true, newLayoutDesigns: true },
  publicActions: { share: false, update: false },
})
```

- [ ] **Step 2: Write RED behavior tests for Provider rows**

Use existing component test style to prove admin providers render as connected/read-only and are not placed in the connectable supplier list.

- [ ] **Step 3: Run RED**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/product/ui-registry.test.ts src/product/ui-surface.test.ts
```

Expected: FAIL because `ui-registry.ts` is missing and current source tests still depend on scattered `ProductCapabilities` calls.

- [ ] **Step 4: Implement registry**

`ProductCapabilities` becomes a compatibility layer:

```ts
export const ProductCapabilities = {
  visibleProviderActions(provider: Provider) {
    return ProductUiRegistry.providerActions(Product.profile, provider)
  },
  visibleSettingsToggles(state: { newLayout?: boolean }) {
    return ProductUiRegistry.localPreferences(Product.profile, state)
  },
  visibleDesktopEntries() {
    return ProductUiRegistry.desktopEntries(Product.profile)
  },
}
```

- [ ] **Step 5: Remove scattered UI ownership**

Use registry outputs in settings/provider/model dialogs. Keep local preference controls for theme, language, font, shortcuts, notifications and V1/V2 layout.

- [ ] **Step 6: Run GREEN**

Run:

```bash
bun test --conditions=solid --preload ./happydom.ts src/product/ui-registry.test.ts src/product/ui-surface.test.ts
bun test --conditions=solid --preload ./happydom.ts src/components/settings-providers.test.ts src/components/settings-v2/providers.test.ts
```

If a listed component test does not exist, create it in the same task and cover the behavior above.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/product packages/app/src/components
git commit -m "feat(app): 使用产品 UI 注册表收敛企业入口"
```

---

### Task 6: Desktop 身份与真实版本链路

**Files:**

- Modify: `packages/desktop/src/main/product-identity.ts`
- Modify: `packages/desktop/src/main/product-capability.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/main/initialization.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/renderer/initialization.ts`
- Modify: `packages/desktop/src/renderer/product-identity.ts`
- Test: `packages/desktop/src/main/product-identity.test.ts`
- Test: `packages/desktop/src/main/product-capability.test.ts`
- Test: `packages/desktop/src/renderer/product-identity.test.ts`
- Test: `packages/desktop/src/renderer/initialization.test.ts`

**Interfaces:**

- Consumes: `Product.deriveChannelIdentity`.
- Produces: runtime identity payload with `displayName`, `directoryName`, `appId`, `protocol`, `visibleVersion`, `userDataKey`.

- [ ] **Step 1: Write RED tests for Profile-derived identity**

Assert dev/prod identity:

```ts
expect(deriveDesktopIdentity("prod")).toMatchObject({
  appId: "ai.bluedcode.desktop",
  protocol: "bluedcode",
  directoryName: "bluedcode",
})
expect(deriveDesktopIdentity("dev")).toMatchObject({
  appId: "ai.bluedcode.desktop.dev",
  protocol: "bluedcode-dev",
  directoryName: "bluedcode-dev",
})
```

- [ ] **Step 2: Write RED tests for visible version**

Renderer initialization must display the full runtime version passed by main, for example `1.18.18-260816-01-a39a781eb3`, not bare `v1.18.18`.

- [ ] **Step 3: Run RED**

Run from `packages/desktop`:

```bash
bun test src/main/product-identity.test.ts src/main/product-capability.test.ts src/renderer/product-identity.test.ts src/renderer/initialization.test.ts
```

Expected: FAIL if any identity remains build-rule-owned.

- [ ] **Step 4: Implement main/preload/renderer payload**

Main owns `app.getVersion()` and sends the same value through preload to renderer. Do not patch this in build output.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test src/main/product-identity.test.ts src/main/product-capability.test.ts src/renderer/product-identity.test.ts src/renderer/initialization.test.ts
bun typecheck
```

Expected: PASS or only documented unrelated `custom-elements.d.ts` TS1128 remains; record exact output.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main packages/desktop/src/preload packages/desktop/src/renderer
git commit -m "feat(desktop): 从产品 Profile 派生桌面身份"
```

---

### Task 7: 删除废弃企业构建改写与 Profile 派生 manifest

**Files:**

- Delete: `xcode/build/bluedcode/common/enterprise.ts`
- Delete: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-policy.ts`
- Delete: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-provider-ui.ts`
- Delete: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-public-surface.ts`
- Delete: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-share-ui.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/build.ts`
- Test: `xcode/build/bluedcode/test/enterprise.test.ts`
- Test: `xcode/build/bluedcode/test/adapter.test.ts`
- Test: `xcode/build/bluedcode/test/build.test.ts`
- Test: `xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`

**Interfaces:**

- Consumes: `Product.profile.operations`.
- Produces: `enterprisePolicyFromProfile(profile)` only as manifest/audit projection, not a separate literal.

- [ ] **Step 1: Write RED test that enterprise policy cannot be independently edited**

Test that build manifest enterprise section equals projection from `Product.profile.operations`; changing a fixture literal must fail exact schema validation.

- [ ] **Step 2: Write RED test that obsolete rules are absent**

Assert no `runtime-policy-rewrite` rule kind exists and no enterprise rule files are imported by `version/1.18.18/index.ts`.

- [ ] **Step 3: Run RED**

Run from `xcode/build/bluedcode`:

```bash
bun test test/enterprise.test.ts test/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts
```

Expected: FAIL while old `EnterprisePolicy` files still exist.

- [ ] **Step 4: Delete obsolete rule files and update manifest**

Replace `enterprisePolicy11818` with a pure projection function in manifest/build common code:

```ts
const enterprise = projectEnterprisePolicy(Product.profile.operations)
```

Do not transform server/provider/share business code in the adapter.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/enterprise.test.ts test/adapter.test.ts test/build.test.ts version/1.18.18/tests/fail-closed.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xcode/build/bluedcode
git commit -m "refactor(build): 由产品 Profile 派生企业审计"
```

---

### Task 8: VersionAdapter Registry 与公共流程解耦

**Files:**

- Create: `xcode/build/bluedcode/common/adapter-registry.ts`
- Modify: `xcode/build/bluedcode/common/adapter.ts`
- Modify: `xcode/build/bluedcode/common/server.ts`
- Modify: `xcode/build/bluedcode/common/plugins.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/common/build.ts`
- Modify: `xcode/build/bluedcode/build.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/electron-vite.ts`
- Test: `xcode/build/bluedcode/test/adapter.test.ts`
- Test: `xcode/build/bluedcode/test/server.test.ts`
- Test: `xcode/build/bluedcode/test/plugins.test.ts`
- Test: `xcode/build/bluedcode/test/build.test.ts`
- Test: `xcode/build/bluedcode/test/snapshot.test.ts`

**Interfaces:**

- Produces: `registerVersionAdapter(adapter)`, `selectVersionAdapter(input)`, `VersionAdapter`.
- Consumes: existing `adapter11818` object, renamed to `version11818Adapter` and registered only from `version/1.18.18/index.ts`.

- [ ] **Step 1: Write RED test rejecting direct adapter import**

Add source scan tests:

```ts
expect(await source("common/server.ts")).not.toContain("adapter11818")
expect(await source("build.ts")).not.toContain("adapter11818")
expect(await source("version/1.18.18/electron-vite.ts")).not.toContain("adapter11818")
```

- [ ] **Step 2: Write RED tests for registry selection**

Assert registered `tag=v1.18.18` and `commit=31406...` selects adapter, while unknown tag/commit fails in preflight before build stages.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test test/adapter.test.ts test/server.test.ts test/plugins.test.ts test/build.test.ts
```

Expected: FAIL because common flow imports `adapter11818`.

- [ ] **Step 4: Implement registry and dependency injection**

Pass `adapter: VersionAdapter` through server build, Electron Vite plugin, Electron Builder, manifest and audit. Version-specific files may import their local adapter; common files may not.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/adapter.test.ts test/server.test.ts test/plugins.test.ts test/build.test.ts test/snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xcode/build/bluedcode
git commit -m "refactor(build): 通过版本适配器注册表选择构建合同"
```

---

### Task 9: 语义块转换与审计降噪

**Files:**

- Modify: `xcode/build/bluedcode/common/transform/types.ts`
- Modify: `xcode/build/bluedcode/common/transform/engine.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/rules/locales.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/rules/preserved-identities.ts`
- Modify: `xcode/build/bluedcode/common/audit.ts`
- Test: `xcode/build/bluedcode/test/transform.test.ts`
- Test: `xcode/build/bluedcode/test/audit.test.ts`
- Test: `xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts`

**Interfaces:**

- Produces: `TransformRecord` with `kind: "semantic-block" | "static-resource" | "evidence"`, aggregated by file/rule.
- Consumes: existing locale AST string transform and output audit policy.

- [ ] **Step 1: Write RED tests for full string/block replacement**

Use a fixture where one string contains multiple OpenCode tokens and assert one record:

```ts
expect(result.records).toEqual([expect.objectContaining({ id: "locale:brand-name", hits: 3, kind: "semantic-block" })])
```

- [ ] **Step 2: Write RED tests for audit classes**

Assert forbidden user-reachable tokens remain exact-zero, preserved internal identities are allowed with rationale, and evidence tokens do not require brittle global counts.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test test/transform.test.ts test/audit.test.ts version/1.18.18/tests/adapter.test.ts
```

Expected: FAIL where records are still per-token or audit counts are over-specific.

- [ ] **Step 4: Implement aggregation and audit classes**

Keep AST/string parsing. Do not switch to broad blind text replacement. Aggregate related replacements into one record per semantic block and retain before/after digest.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/transform.test.ts test/audit.test.ts version/1.18.18/tests/adapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xcode/build/bluedcode/common xcode/build/bluedcode/version/1.18.18
git commit -m "refactor(build): 按语义块记录品牌转换与审计"
```

---

### Task 10: prepare-version 与 adapter-diff 工具

**Files:**

- Create: `xcode/build/bluedcode/tools/prepare-version.ts`
- Create: `xcode/build/bluedcode/tools/adapter-diff.ts`
- Create: `xcode/build/bluedcode/test/adapter-tools.test.ts`
- Modify: `xcode/build/bluedcode/snapshot-manifest.json`

**Interfaces:**

- Consumes: `VersionAdapter`, `ModuleContract`, Git baseline.
- Produces: read-only reports under `.xcode/bluedcode/reports/<run-id>/`, never auto-accepts fingerprints.

- [ ] **Step 1: Write RED tests for read-only behavior**

Test both tools against fixtures and assert:

```ts
expect(report.accepted).toBe(false)
expect(report.candidates.every((item) => item.status === "candidate")).toBe(true)
expect(gitTrackedDigestAfter).toBe(gitTrackedDigestBefore)
```

- [ ] **Step 2: Write RED tests for new route/source candidates**

Fixture with a new HTTP handler, new Provider entry and new renderer connect button must appear in candidate report.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test test/adapter-tools.test.ts
```

Expected: FAIL because the tools do not exist.

- [ ] **Step 4: Implement tools**

`prepare-version.ts` creates candidate version directory and report only under ignored `.xcode`; `adapter-diff.ts` compares old/new source path, normalized AST/text digest, stage and risk classification.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/adapter-tools.test.ts test/snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xcode/build/bluedcode/tools xcode/build/bluedcode/test xcode/build/bluedcode/snapshot-manifest.json
git commit -m "feat(build): 增加版本适配候选与差异报告工具"
```

---

### Task 11: 真实 Portable 启动验收

**Files:**

- Modify: `xcode/build/bluedcode/common/runtime-acceptance.ts`
- Modify: `xcode/build/bluedcode/common/failure.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/build.ts`
- Test: `xcode/build/bluedcode/test/runtime-acceptance.test.ts`
- Test: `xcode/build/bluedcode/test/failure.test.ts`
- Test: `xcode/build/bluedcode/test/build.test.ts`

**Interfaces:**

- Consumes: final Portable EXE path and isolated config directory.
- Produces: `RuntimeAcceptanceEvidence` with stages `portable-startup`, `server-health`, `preload`, `renderer`, `runtime`, no secrets.

- [ ] **Step 1: Write RED tests for executable smoke contract**

Test that source-only fixture is insufficient:

```ts
expect(() => createRuntimeAcceptanceEvidence({ executable: undefined })).toThrow("缺少最终 Portable EXE")
```

Test that evidence requires:

```ts
expect(evidence).toMatchObject({
  executableStarted: true,
  serverHealthReady: true,
  preloadReady: true,
  rendererReady: true,
  adminModelLoaded: true,
  exitedCleanly: true,
  lingeringProcesses: [],
})
```

- [ ] **Step 2: Write RED tests for secret redaction**

Admin config fixture includes an API key; manifest and failure report must contain only hashes or provider/model IDs, never the key.

- [ ] **Step 3: Run RED**

Run:

```bash
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts
```

Expected: FAIL because runtime acceptance is currently source fixture only.

- [ ] **Step 4: Implement Portable smoke harness**

Launch final EXE with isolated environment variables and a run-id state channel. Wait for main, server health, preload and renderer readiness. Write minimal `.config/bluedcode/opencode.json` with admin Provider/model. Close gracefully and assert no leftover process.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add xcode/build/bluedcode/common xcode/build/bluedcode/build.ts xcode/build/bluedcode/test
git commit -m "feat(build): 增加最终 Portable 启动验收"
```

---

### Task 12: 根仓资源清理与子仓独立构建边界

**Files:**

- In root repo delete: `xcode/build/bluedcode/common/**`
- In root repo delete: `xcode/build/bluedcode/snapshot-manifest.json`
- In root repo delete: `xcode/build/bluedcode/tui.json`
- In root repo keep: `xcode/build/bluedcode/brand.json`
- In root repo keep: `xcode/build/bluedcode/app-icon.svg`
- In root repo keep: `xcode/build/bluedcode/app-icon.png`
- In root repo keep: `xcode/build/bluedcode/wordmark.svg`
- Create or modify root: `xcode/build/bluedcode/resource-manifest.json`
- Modify subrepo: `xcode/build/bluedcode/test/snapshot.test.ts`
- Modify root: `AGENTS.md` only if implementation reveals a missing rule

**Interfaces:**

- Produces: root resource manifest with SHA256 for each kept asset; subrepo snapshot verifies copied asset hashes.
- Consumes: root/subrepo resource files.

- [ ] **Step 1: Write RED test in subrepo for resource-only root contract**

Add a test that points at the parent repo when present and rejects `.ts`, `.js`, `common/`, `tools/`, `snapshot-manifest.json`, and `tui.json` under root `xcode/build/bluedcode`.

- [ ] **Step 2: Run RED**

Run from `opencode/xcode/build/bluedcode`:

```bash
bun test test/snapshot.test.ts
```

Expected: FAIL because root still contains `common/**/*.ts`.

- [ ] **Step 3: Delete root build code safely**

Use explicit file deletion only inside `D:\Develop\foreachcode\xcode\build\bluedcode\common` plus the two named obsolete files. Do not delete root source assets.

- [ ] **Step 4: Add root resource manifest**

Record SHA256 for `brand.json`, `app-icon.svg`, `app-icon.png`, `wordmark.svg`. Do not include executable code.

- [ ] **Step 5: Run GREEN**

Run:

```bash
bun test test/snapshot.test.ts
git -C D:\Develop\foreachcode diff --check
git -C D:\Develop\foreachcode\opencode diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit root and subrepo separately**

Subrepo:

```bash
git add xcode/build/bluedcode/test/snapshot.test.ts
git commit -m "test(build): 验证根仓只保留品牌资源"
```

Root:

```bash
git add AGENTS.md xcode/build/bluedcode docs/origin-specs opencode
git commit -m "chore: 清理根仓构建代码并记录资源摘要"
```

---

### Task 13: 端到端验证、产物、规格矩阵与历史重整准备

**Files:**

- Modify: `docs/superpowers/specs/2026-08-16-03-product-profile-architecture-design.md`
- Modify root: `docs/origin-specs/01-product-branding.md`
- Modify root: `docs/origin-specs/02-enterprise-product-policy.md`
- Modify root: `docs/origin-specs/07-product-profile-architecture.md`
- Create: `.superpowers/sdd/2026-08-17-product-profile-sustainability-convergence/final-report.md`

**Interfaces:**

- Consumes: all previous task commits and final Portable artifacts.
- Produces: final verification report and spec matrix updates only after all acceptance passes.

- [ ] **Step 1: Run package-level tests**

Run:

```bash
cd packages/product && bun test test && bun typecheck
cd ../opencode && bun test src/config/product-policy.test.ts src/config/admin-config.test.ts src/provider/product-provider.test.ts src/product/network-policy.test.ts && bun typecheck
cd ../app && bun test --conditions=solid --preload ./happydom.ts src/product src/components && bun typecheck
cd ../desktop && bun test src/main src/renderer && bun typecheck
```

Record any unrelated existing blocker with exact file and diagnostic.

- [ ] **Step 2: Run build tests and audit-only**

Run:

```bash
cd xcode/build/bluedcode
bun test test
bun run build.ts --channel dev --audit-only
```

Expected: PASS.

- [ ] **Step 3: Build dev and prod Portable**

Run:

```bash
bun run build.ts --channel dev
bun run build.ts --channel prod --release-date 260816 --release-number 01
```

Expected: final artifacts are Windows x64 Portable EXE plus `release-manifest.json`; no MSI, ZIP, YAML, updater, CLI, Web or TUI artifact.

- [ ] **Step 4: Run real Portable acceptance**

For both dev and prod, run the final EXE smoke harness. Assert real `.config/bluedcode/opencode.json` model loading, V1 default, V2 switch persistence, no startup JavaScript error, clean restart without stale session fatal error, disabled entry behavior, and no lingering process.

- [ ] **Step 5: Run SubAgent review**

Dispatch review agents for:

```text
1. 源码企业根边界与 UI Registry
2. 构建 adapter registry、ledger、manifest 和 root resource boundary
3. 最终 Portable 产物与真实启动验收
```

Fix review findings with RED -> GREEN commits before marking complete.

- [ ] **Step 6: Update specs and matrices**

Only after all acceptance and review findings are resolved, update origin matrices with the final commit ID that satisfies the whole contract. Update version spec verification section with artifact paths, SHA256, runtime evidence and known unrelated blockers.

- [ ] **Step 7: Commit docs**

Subrepo:

```bash
git add docs/superpowers/specs/2026-08-16-03-product-profile-architecture-design.md .superpowers/sdd/2026-08-17-product-profile-sustainability-convergence/final-report.md
git commit -m "docs: 记录产品 Profile 收敛验收结果"
```

Root:

```bash
git add docs/origin-specs opencode
git commit -m "docs: 更新产品收敛实现矩阵"
```

- [ ] **Step 8: Prepare history rewrite only after approval**

If the user confirms force push, create safety refs for root and subrepo current HEAD, then rebuild subrepo history from `v1.18.18` into:

```text
feat(product): 实现 BluedCode 产品与桌面构建
feat(enterprise): 实现 BluedCode 企业产品策略
```

Use `git push --force-with-lease` only after recording the remote old HEAD and confirming there are no unknown remote commits.

---

## Self-Review

- Spec coverage: ORIGIN-01 identity/build/resource behavior is covered by Tasks 1, 6, 8, 9, 11, 12 and 13. ORIGIN-02 enterprise policy is covered by Tasks 1 through 5 and final runtime acceptance. ORIGIN-07 sustainability concerns are covered by Tasks 7 through 13.
- Root仓无构建代码: Task 12 explicitly removes root executable build code and adds an automated resource-only test.
- Version 解耦: Task 8 removes `adapter11818` from common build flow and adds registry selection tests.
- 企业能力根源禁用: Tasks 2 through 4 centralize config, integration registries and public side-effect services; Task 5 centralizes UI surface.
- 本地基础配置保留: Task 2 and Task 5 explicitly allow local preference fields and test GUI registry exposure.
- 真实启动验收: Task 11 and Task 13 require final Portable EXE execution, not source fixture-only proof.
- No placeholders: every task has exact files, named interfaces, commands, expected failure mode, implementation target and commit message.
