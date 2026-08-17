# BluedCode 产品 Profile 混合架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 BluedCode 1.18.18 的产品身份、桌面行为和企业策略迁移到源码中的静态 Product Profile，同时保留构建层的资源、发行和最终审计能力。

**Architecture:** 新增底层 `@foreachcode/product` 作为唯一生产产品事实源；`core`、`desktop`、`opencode server` 和 `app` 直接依赖它实现运行时语义。`xcode/build/bluedcode` 删除已迁移的业务 AST 转换，收敛为读取 Profile、生成资源、打 Windows x64 Portable、记录 ledger/manifest 并验证最终产物一致性的构建框架。

**Tech Stack:** Bun 1.x、TypeScript、Effect、SolidJS、Electron 42、Electron Vite 5、Electron Builder、Bun test、现有 `xcode/build/bluedcode` 审计与 Portable 框架。

**Spec:** `docs/superpowers/specs/2026-08-16-03-product-profile-architecture-design.md`（对应根仓 `docs/origin-specs/07-product-profile-architecture.md` / `ORIGIN-07`，并迁移 `ORIGIN-01`、`ORIGIN-02`）

## Global Constraints

- 基线必须是 OpenCode tag `v1.18.18`，基线提交必须是 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`，实现分支必须是 `dev-foreachcode-1.18.18`。
- 本分支只构建 BluedCode，不支持同一源码树运行时切回 OpenCode。
- `@foreachcode/product` 必须是生产唯一静态产品事实源；Profile 不接受环境变量、命令行、用户配置、LocalStorage 或远程响应覆盖。
- BluedCode prod 固定为 `BluedCode` / `bluedcode` / `ai.bluedcode.desktop` / `bluedcode://`；dev 必须由同一 Profile 派生为 `BluedCode Dev` / `bluedcode-dev` / `ai.bluedcode.desktop.dev` / `bluedcode-dev://`。
- 新品牌是新完整 Profile，AppData、`.config/<directoryName>`、缓存、日志、窗口状态、app ID、Deep Link、manifest 和发行文件名都必须随新 Profile 改变；不得默认读取、迁移、复制、修改或删除 BluedCode 数据。
- Windows 配置目录必须保持 OpenCode 原始布局规则，只替换产品目录段：`C:\Users\<user>\.config\bluedcode\config.json`、`opencode.json`、`opencode.jsonc`。不得改成 `ProgramData`，不得额外增加嵌套目录，也不得扫描 `.config/opencode`。
- 只支持 Windows x64 Desktop Portable；CLI、Web、TUI、updater、WSL 管理和后台 CLI 是禁用能力。
- 默认 V1 布局；设置页必须有“新布局 / New layout”开关允许切换 V2。
- 企业 Provider 模式固定为 `admin-static-only`：`.config/bluedcode` 的 `provider` 和 `model` 必须正常生效，但管理员 Provider 不能显示成用户可配置供应商。
- 稳定错误码必须包括 `PRODUCT_CAPABILITY_DISABLED`、`PROVIDER_MANAGED_BY_ADMIN`、`CONFIG_WRITE_DISABLED`、`PUBLIC_SHARE_DISABLED`、`PUBLIC_UPDATE_DISABLED`。
- Provider/Auth/config 写入必须在读取敏感请求体、持久化或网络之前失败；分享、更新、公共模型目录、遥测和公共代理必须在网络之前失败。
- 构建层继续负责资源、locale 静态产品名、Windows x64 Portable、PE/版本/文件名、缓存、隔离、Git 认证、ASAR/EXE/final payload exact audit、manifest 和运行验收。
- 构建层必须删除 app ID、Deep Link、userData、配置目录、V1/V2、CLI/WSL/updater、Provider/Auth/config/share/update/models/telemetry 等运行时语义改写。
- server Bun build 与 Electron Vite 必须进入统一转换/审计 ledger；manifest 必须覆盖 source、server、main、preload、renderer、assets、package、portable、runtime。
- 构建执行不得改写 lockfile、`node_modules` 或未纳入任务的上游源码；实现源码需求后必须运行当前版本品牌兼容审计。
- 所有新增或修改行为必须按 TDD：先写聚焦测试并确认 RED，再写最小实现，再运行聚焦测试、包级验证和任务级审计。
- 子代理每个任务必须提交中文 commit。最终验收后，从 `v1.18.18` 重建为两条中文语义提交，并用 `--force-with-lease` 推送已确认分支。

---

## File Structure

- `packages/product/`：新增底层产品包。只定义 Profile、派生 identity、capability 判断和结构化产品错误，不依赖上层包。
- `packages/core/src/...`：把配置、数据、缓存、日志目录从硬编码 OpenCode 目录迁移为读取 `Product.directoryName`。
- `packages/desktop/src/...`：把 app ID、Deep Link、userData、窗口标题、sidecar 环境、禁用能力和 V1/V2 默认值迁移为源码逻辑。
- `packages/opencode/src/product/...`：放服务端产品策略边界，例如 Provider 管理、config/auth 写入、分享、更新、公共目录、公共代理和稳定错误映射。
- `packages/opencode/src/provider/**`、`src/config/**`、`src/server/**`：接入服务端产品策略，保留只读 Provider/model 能力，拒绝写入和公共网络。
- `packages/app/src/product/...`：放 UI 层 capability helpers，让设置、Provider、分享、更新、WSL/CLI 入口使用同一产品能力。
- `xcode/build/bluedcode/common/**`：保留通用构建能力，新增 Profile 读取、ModuleContract 派生、统一 ledger、failure report、完整快照。
- `xcode/build/bluedcode/version/1.18.18/**`：保留 1.18.18 静态 locale/resource/packaging 适配，删除已迁入源码的语义转换。
- `docs/superpowers/specs/**` 与根仓 `docs/origin-specs/**`：只在完成验收后更新矩阵和迁移结果。

### Task 1: Product Profile Package

**Files:**

- Create: `packages/product/package.json`
- Create: `packages/product/tsconfig.json`
- Create: `packages/product/src/index.ts`
- Create: `packages/product/src/profile.ts`
- Create: `packages/product/src/identity.ts`
- Create: `packages/product/src/capability.ts`
- Create: `packages/product/src/error.ts`
- Create: `packages/product/test/profile.test.ts`
- Create: `packages/product/test/capability.test.ts`
- Create: `packages/product/test/error.test.ts`
- Modify: `package.json`
- Modify: `bun.lock` only if Bun workspace metadata requires it after adding the package

**Interfaces:**

- Produces: `Product.profile`, `Product.deriveChannelIdentity(profile, channel)`, `Product.assertCapability(profile, capability)`, `Product.ProductError`, `Product.ErrorCode`.
- Consumes: no workspace packages; only TypeScript/Bun standard runtime.

- [ ] **Step 1: Write RED tests for immutable BluedCode Profile**

  Add `packages/product/test/profile.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { Product } from "../src"

  describe("Product Profile", () => {
    test("production profile is the only BluedCode product identity", () => {
      expect(Product.profile.identity).toEqual({
        displayName: "BluedCode",
        directoryName: "bluedcode",
        appId: "ai.bluedcode.desktop",
        protocol: "bluedcode",
      })
      expect(Product.profile.capabilities).toMatchObject({
        desktop: true,
        cli: false,
        web: false,
        tui: false,
        updater: false,
        publicShare: false,
        telemetry: false,
        publicProviderCatalog: false,
        providerManagement: "admin-static-only",
      })
    })

    test("dev identity is deterministically isolated from prod", () => {
      expect(Product.deriveChannelIdentity(Product.profile, "dev")).toEqual({
        channel: "dev",
        displayName: "BluedCode Dev",
        directoryName: "bluedcode-dev",
        appId: "ai.bluedcode.desktop.dev",
        protocol: "bluedcode-dev",
      })
      expect(Product.deriveChannelIdentity(Product.profile, "prod").directoryName).toBe("bluedcode")
    })

    test("profile cannot be mutated through exported references", () => {
      expect(() => {
        ;(Product.profile.identity as { displayName: string }).displayName = "OpenCode"
      }).toThrow()
      expect(Product.profile.identity.displayName).toBe("BluedCode")
    })
  })
  ```

- [ ] **Step 2: Write RED tests for capabilities and product errors**

  Add `packages/product/test/capability.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { Product } from "../src"

  describe("Product capabilities", () => {
    test("disabled public share fails with stable code", () => {
      expect(() => Product.assertCapability(Product.profile, "publicShare")).toThrow(Product.ProductError)
      try {
        Product.assertCapability(Product.profile, "publicShare")
      } catch (error) {
        expect(Product.isProductError(error)).toBe(true)
        expect((error as Product.ProductError).code).toBe("PUBLIC_SHARE_DISABLED")
      }
    })

    test("desktop capability is allowed", () => {
      expect(Product.assertCapability(Product.profile, "desktop")).toBeUndefined()
    })
  })
  ```

  Add `packages/product/test/error.test.ts`:

  ```ts
  import { expect, test } from "bun:test"
  import { Product } from "../src"

  test("product errors preserve code and safe message without swallowing cause", () => {
    const cause = new Error("disk failed")
    const error = new Product.ProductError("CONFIG_WRITE_DISABLED", "配置写入已由产品策略禁用", { cause })
    expect(error.code).toBe("CONFIG_WRITE_DISABLED")
    expect(error.message).toBe("配置写入已由产品策略禁用")
    expect(error.cause).toBe(cause)
  })
  ```

- [ ] **Step 3: Run RED**

  Run from `packages/product`:

  ```bash
  bun test
  ```

  Expected: FAIL because package and exports do not exist.

- [ ] **Step 4: Implement minimal package**

  Implement `src/profile.ts` with a literal deeply frozen `ProductProfile`; implement `src/identity.ts` as a pure deterministic channel derivation; implement `src/capability.ts` with capability-to-error mapping; implement `src/error.ts` with `ProductError` and `isProductError`.

  Required exported namespace in `src/index.ts`:

  ```ts
  export * as Product from "./profile"
  export { ProductError, isProductError } from "./error"
  export { deriveChannelIdentity } from "./identity"
  export { assertCapability } from "./capability"
  ```

  If the namespace shape above conflicts with local import conventions, use named module namespace exports so consumers can import `Product` without star imports.

- [ ] **Step 5: Run GREEN and package checks**

  Run from `packages/product`:

  ```bash
  bun test
  bun typecheck
  ```

  Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add package.json bun.lock packages/product
  git commit -m "feat(product): 新增 BluedCode 产品 Profile"
  ```

### Task 2: Core and Desktop Product Identity

**Files:**

- Modify: `packages/core/package.json`
- Modify: `packages/core/src/project/project.ts`
- Modify: `packages/core/src/project/instance-store.ts`
- Modify: `packages/core/test/project-directories.test.ts`
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/main/deep-links.ts`
- Modify: `packages/desktop/src/main/window.ts`
- Modify: `packages/desktop/src/main/server.ts`
- Modify: `packages/desktop/src/renderer/initialization.ts`
- Modify: `packages/desktop/src/renderer/initialization.test.ts`
- Test: `packages/desktop/src/main/product-identity.test.ts`
- Test: `packages/desktop/src/main/product-capability.test.ts`

**Interfaces:**

- Consumes: `Product.profile`, `Product.deriveChannelIdentity`, `Product.assertCapability`.
- Produces: `resolveDesktopProductIdentity(channel)`, `resolveProductConfigPaths(home)`, `assertDesktopCapability(capability)`.

- [ ] **Step 1: RED for config path compatibility**

  In `packages/core/test/project-directories.test.ts`, add a Windows path fixture:

  ```ts
  test("BluedCode uses upstream config filenames under .config/bluedcode", () => {
    const paths = ProjectDirectories.forHome("C:\\Users\\Foreach")
    expect(paths.configFiles.map((file) => file.replaceAll("/", "\\"))).toEqual([
      "C:\\Users\\Foreach\\.config\\bluedcode\\config.json",
      "C:\\Users\\Foreach\\.config\\bluedcode\\opencode.json",
      "C:\\Users\\Foreach\\.config\\bluedcode\\opencode.jsonc",
    ])
    expect(paths.configFiles.some((file) => file.includes(".config\\opencode"))).toBe(false)
    expect(paths.configFiles.some((file) => file.includes("ProgramData"))).toBe(false)
  })
  ```

- [ ] **Step 2: RED for Desktop identity and disabled entrypoints**

  Add `packages/desktop/src/main/product-identity.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { resolveDesktopProductIdentity } from "./product-identity"

  describe("Desktop product identity", () => {
    test("prod and dev app identity are isolated", () => {
      expect(resolveDesktopProductIdentity("prod")).toMatchObject({
        displayName: "BluedCode",
        appId: "ai.bluedcode.desktop",
        protocol: "bluedcode",
      })
      expect(resolveDesktopProductIdentity("dev")).toMatchObject({
        displayName: "BluedCode Dev",
        appId: "ai.bluedcode.desktop.dev",
        protocol: "bluedcode-dev",
      })
    })
  })
  ```

  Add `packages/desktop/src/main/product-capability.test.ts`:

  ```ts
  import { expect, test } from "bun:test"
  import { assertDesktopCapability } from "./product-capability"

  test("CLI, WSL and updater are disabled before process or network side effects", () => {
    expect(() => assertDesktopCapability("cli")).toThrow("PRODUCT_CAPABILITY_DISABLED")
    expect(() => assertDesktopCapability("updater")).toThrow("PRODUCT_CAPABILITY_DISABLED")
    expect(() => assertDesktopCapability("wsl")).toThrow("PRODUCT_CAPABILITY_DISABLED")
  })
  ```

- [ ] **Step 3: Run RED**

  Run:

  ```bash
  cd packages/core
  bun test test/project-directories.test.ts
  cd ../desktop
  bun test src/main/product-identity.test.ts src/main/product-capability.test.ts src/renderer/initialization.test.ts
  ```

  Expected: FAIL because product identity helpers and BluedCode path behavior are missing.

- [ ] **Step 4: Implement Core and Desktop product reads**

  Add focused helper modules near the consumers. Replace hardcoded product directory/app ID/protocol values with calls to `@foreachcode/product`. Keep existing config file names `config.json`, `opencode.json`, `opencode.jsonc`; change only the directory segment to `Product.profile.identity.directoryName`.

  Desktop must set app name, app ID, protocol, userData/window state/log identity and sidecar environment from `resolveDesktopProductIdentity(channel)`. Disabled CLI/WSL/updater paths must call `assertDesktopCapability` before spawning processes, registering background CLI, starting WSL management, or checking updates.

- [ ] **Step 5: Preserve V1 default and V2 switch in source**

  Extend `packages/desktop/src/renderer/initialization.test.ts`:

  ```ts
  test("BluedCode defaults to V1 layout while preserving the new layout toggle", async () => {
    const state = await initializeLayoutState({ storedNewLayout: undefined })
    expect(state.newLayoutEnabled).toBe(false)
    expect(state.settingsToggleVisible).toBe(true)
  })
  ```

  Implement only the layout default and settings visibility needed by the existing renderer initialization boundary.

- [ ] **Step 6: Run GREEN and package checks**

  Run:

  ```bash
  cd packages/core
  bun test test/project-directories.test.ts
  bun typecheck
  cd ../desktop
  bun test src/main/product-identity.test.ts src/main/product-capability.test.ts src/renderer/initialization.test.ts
  bun typecheck
  ```

- [ ] **Step 7: Remove matching build semantic transforms**

  In `xcode/build/bluedcode/version/1.18.18/**`, delete or convert to audit-only any rules that rewrite app ID, Deep Link, userData/config directory, V1/V2 default, CLI/WSL/updater behavior. Add a build adapter test that fails if those rule IDs still appear.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/core packages/desktop xcode/build/bluedcode
  git commit -m "feat(product): 用产品 Profile 驱动核心路径与桌面身份"
  ```

### Task 3: Server Enterprise Policy in Source

**Files:**

- Modify: `packages/opencode/package.json`
- Create: `packages/opencode/src/product/policy.ts`
- Create: `packages/opencode/src/product/provider-policy.ts`
- Create: `packages/opencode/src/product/network-policy.ts`
- Test: `packages/opencode/test/product/provider-policy.test.ts`
- Test: `packages/opencode/test/product/config-policy.test.ts`
- Test: `packages/opencode/test/product/network-policy.test.ts`
- Modify: `packages/opencode/src/provider/provider.ts`
- Modify: `packages/opencode/src/provider/auth.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/share/share.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/share.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/app.ts`

**Interfaces:**

- Consumes: `Product.profile`, `Product.ProductError`, core config loading.
- Produces: `ProductPolicy.requireProviderRead()`, `ProductPolicy.rejectProviderWrite()`, `ProductPolicy.rejectConfigWrite(payload)`, `ProductPolicy.rejectPublicNetwork(kind)`, `ProviderPolicy.listAdminProviders(config)`, `ProviderPolicy.resolveAdminModel(config, modelID)`.

- [ ] **Step 1: RED for admin Provider/model config**

  Add `packages/opencode/test/product/provider-policy.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { ProviderPolicy } from "../../src/product/provider-policy"

  describe("admin-static-only providers", () => {
    test("configured provider and model are usable but managed by admin", () => {
      const result = ProviderPolicy.listAdminProviders({
        provider: {
          "openai-proxy": {
            npm: "@ai-sdk/openai-compatible",
            name: "openai-proxy",
            options: { baseURL: "https://llm.internal.example/v1" },
            models: { "gpt-4.1": { name: "GPT 4.1" } },
          },
        },
        model: "openai-proxy/gpt-4.1",
      })
      expect(result).toEqual([
        {
          id: "openai-proxy",
          name: "openai-proxy",
          managedBy: "admin",
          configurableByUser: false,
          models: [{ id: "openai-proxy/gpt-4.1", name: "GPT 4.1" }],
        },
      ])
    })

    test("environment, auth and public catalog cannot add providers", () => {
      expect(ProviderPolicy.listAdminProviders({ provider: {}, model: undefined })).toEqual([])
    })
  })
  ```

- [ ] **Step 2: RED for write and network boundaries**

  Add `packages/opencode/test/product/config-policy.test.ts`:

  ```ts
  import { expect, test } from "bun:test"
  import { ProductPolicy } from "../../src/product/policy"

  test("provider, auth and config writes fail before persistence", () => {
    expect(() => ProductPolicy.rejectProviderWrite()).toThrow("PROVIDER_MANAGED_BY_ADMIN")
    expect(() => ProductPolicy.rejectAuthWrite()).toThrow("PROVIDER_MANAGED_BY_ADMIN")
    expect(() => ProductPolicy.rejectConfigWrite({ provider: { custom: {} } })).toThrow("CONFIG_WRITE_DISABLED")
  })
  ```

  Add `packages/opencode/test/product/network-policy.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { ProductPolicy } from "../../src/product/network-policy"

  describe("public network product policy", () => {
    test("share, update, model catalog, telemetry and proxy are rejected before network", () => {
      expect(() => ProductPolicy.rejectPublicShare()).toThrow("PUBLIC_SHARE_DISABLED")
      expect(() => ProductPolicy.rejectPublicUpdate()).toThrow("PUBLIC_UPDATE_DISABLED")
      expect(() => ProductPolicy.rejectPublicCatalog()).toThrow("PRODUCT_CAPABILITY_DISABLED")
      expect(() => ProductPolicy.rejectTelemetry()).toThrow("PRODUCT_CAPABILITY_DISABLED")
      expect(() => ProductPolicy.rejectPublicProxy()).toThrow("PRODUCT_CAPABILITY_DISABLED")
    })
  })
  ```

- [ ] **Step 3: Run RED**

  Run from `packages/opencode`:

  ```bash
  bun test test/product/provider-policy.test.ts test/product/config-policy.test.ts test/product/network-policy.test.ts
  ```

  Expected: FAIL because product policy modules do not exist.

- [ ] **Step 4: Implement minimal service policy**

  Implement product policy modules without emptying existing server API groups. Provider list/auth routes must keep their schema shape; OAuth methods return an empty method list or stable policy error; write endpoints return product errors before reading sensitive body fields or calling `auth.set`, `auth.remove`, `config.update`, share service, update service, catalog refresh, telemetry exporter or public proxy fetch.

- [ ] **Step 5: Wire HTTP handlers and direct services**

  Replace existing direct writes/calls with product policy checks at the service boundary. Add a regression test for each previously observed bypass:

  ```ts
  test("control handler cannot persist auth", async () => {
    const writes: string[] = []
    const result = await callControlHandlerWithPolicy({ onWrite: (key) => writes.push(key) })
    expect(result.status).toBe(403)
    expect(writes).toEqual([])
  })
  ```

  Use real handler/service utilities if present; if a full HTTP fixture is too heavy, create a narrow test fixture that invokes the exported handler with a fake persistence dependency and asserts no write callback is reached.

- [ ] **Step 6: Remove matching enterprise build transforms**

  Delete the 1.18.18 build rules that rewrote Provider/Auth/config/share/update/models/telemetry behavior. Add adapter tests that assert no semantic enterprise rule IDs remain and that server build only performs static locale/resource transformations plus ledger/audit.

- [ ] **Step 7: Run GREEN and package checks**

  Run from `packages/opencode`:

  ```bash
  bun test test/product/provider-policy.test.ts test/product/config-policy.test.ts test/product/network-policy.test.ts
  bun typecheck
  ```

  Then run from `xcode/build/bluedcode`:

  ```bash
  bun test test/adapter.test.ts test/electron-vite.test.ts test/build.test.ts
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add packages/opencode xcode/build/bluedcode
  git commit -m "feat(enterprise): 在服务边界实现企业产品策略"
  ```

### Task 4: App Product UI and Settings

**Files:**

- Modify: `packages/app/package.json`
- Create: `packages/app/src/product/capabilities.ts`
- Test: `packages/app/src/product/capabilities.test.ts`
- Modify: `packages/app/src/pages/settings.tsx`
- Modify: `packages/app/src/pages/settings.test.tsx`
- Modify: `packages/app/src/pages/providers.tsx`
- Modify: `packages/app/src/pages/providers.test.tsx`
- Modify: `packages/app/src/updater.ts`
- Modify: `packages/app/src/desktop-menu.ts`
- Modify: `packages/app/src/desktop-menu.test.ts`
- Modify: `packages/app/src/pages/session/share*.ts*` if those files exist in this branch

**Interfaces:**

- Consumes: `@foreachcode/product` capability flags and server provider response fields `managedBy: "admin"` and `configurableByUser: false`.
- Produces: `ProductCapabilities.visibleProviderActions(provider)`, `ProductCapabilities.visibleSettingsToggles(state)`, UI behavior that hides disabled write/public entries while preserving admin Provider/model selection.

- [ ] **Step 1: RED for provider UI classification**

  Add or extend `packages/app/src/pages/providers.test.tsx`:

  ```tsx
  test("admin providers are shown as connected but not configurable", async () => {
    renderProviderPage({
      providers: [
        {
          id: "openai-proxy",
          name: "openai-proxy",
          managedBy: "admin",
          configurableByUser: false,
          models: [{ id: "openai-proxy/gpt-4.1", name: "GPT 4.1" }],
        },
      ],
    })
    expect(screen.getByText("openai-proxy")).toBeInTheDocument()
    expect(screen.queryByText("连接")).toBeNull()
    expect(screen.queryByText("配置")).toBeNull()
    expect(screen.queryByText("断开")).toBeNull()
  })
  ```

- [ ] **Step 2: RED for settings and disabled public entries**

  Extend settings/menu tests:

  ```tsx
  test("settings defaults to V1 and exposes New layout switch", () => {
    renderSettings({ newLayout: false })
    expect(screen.getByLabelText(/New layout|新布局/)).toBeInTheDocument()
    expect(screen.getByLabelText(/New layout|新布局/)).not.toBeChecked()
  })

  test("share, update, WSL and CLI entries are hidden by product capabilities", () => {
    const items = buildDesktopMenuItems()
    expect(items.some((item) => item.id === "check-updates")).toBe(false)
    expect(items.some((item) => item.id === "install-cli")).toBe(false)
    expect(items.some((item) => item.id === "wsl-settings")).toBe(false)
  })
  ```

- [ ] **Step 3: Run RED**

  Run from `packages/app`:

  ```bash
  bun test src/product/capabilities.test.ts src/pages/providers.test.tsx src/pages/settings.test.tsx src/desktop-menu.test.ts
  ```

  Expected: FAIL because product capability UI helpers or behavior are missing.

- [ ] **Step 4: Implement UI helpers and minimal component wiring**

  Add `src/product/capabilities.ts` that maps `Product.profile.capabilities` to UI decisions. Provider UI must show admin Provider/model as usable data, not under user-configurable supplier actions. Settings must keep the V2 toggle visible and default off. Menus and buttons for share/update/CLI/WSL must be hidden, and any direct action handler must still surface the stable product error if invoked programmatically.

- [ ] **Step 5: Run GREEN and package checks**

  Run from `packages/app`:

  ```bash
  bun test src/product/capabilities.test.ts src/pages/providers.test.tsx src/pages/settings.test.tsx src/desktop-menu.test.ts
  bun typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/app
  git commit -m "feat(app): 展示企业只读 Provider 与产品能力入口"
  ```

### Task 5: Build Framework Convergence

**Files:**

- Modify: `xcode/build/bluedcode/common/adapter.ts`
- Modify: `xcode/build/bluedcode/common/server.ts`
- Modify: `xcode/build/bluedcode/common/plugins.ts`
- Modify: `xcode/build/bluedcode/common/ledger.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/common/snapshot.ts`
- Modify: `xcode/build/bluedcode/common/build.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/rules/**`
- Test: `xcode/build/bluedcode/test/adapter.test.ts`
- Test: `xcode/build/bluedcode/test/server.test.ts`
- Test: `xcode/build/bluedcode/test/electron-vite.test.ts`
- Test: `xcode/build/bluedcode/test/manifest.test.ts`
- Test: `xcode/build/bluedcode/test/snapshot.test.ts`

**Interfaces:**

- Consumes: source `@foreachcode/product` Profile and existing static brand/resource contracts.
- Produces: `VersionAdapter`, `ModuleContract[]`, `deriveBuildTargets(adapter)`, `writeUnifiedLedger(events)`, `assertProfileConsistentWithArtifact(manifest)`, full root/sub framework snapshot manifest.

- [ ] **Step 1: RED for ModuleContract as single source**

  Extend `adapter.test.ts`:

  ```ts
  test("ModuleContract derives fingerprints, build targets and ledger coverage without duplicate lists", () => {
    const targets = deriveBuildTargets(adapter11818)
    expect(new Set(targets.map((target) => target.moduleId)).size).toBe(targets.length)
    expect(targets.every((target) => adapter11818.modules.some((module) => module.id === target.moduleId))).toBe(true)
    expect(
      adapter11818.modules.some((module) => module.rules.some((rule) => rule.kind === "runtime-policy-rewrite")),
    ).toBe(false)
  })
  ```

- [ ] **Step 2: RED for unified server/Electron ledger**

  Extend `server.test.ts` and `electron-vite.test.ts`:

  ```ts
  test("server and electron stages write one ledger schema with product profile digest", async () => {
    const ledger = await buildFixtureAndReadLedger()
    expect(ledger.events.map((event) => event.stage)).toEqual(
      expect.arrayContaining(["server", "main", "preload", "renderer"]),
    )
    expect(new Set(ledger.events.map((event) => event.productProfileSha256)).size).toBe(1)
  })
  ```

- [ ] **Step 3: RED for full framework snapshot**

  Extend `snapshot.test.ts`:

  ```ts
  test("root/sub framework snapshot covers all public framework files", async () => {
    const manifest = await verifySnapshot({ includeFramework: true })
    expect(manifest.files.some((file) => file.path === "common/build.ts")).toBe(true)
    expect(manifest.files.some((file) => file.path === "brand.json")).toBe(true)
    expect(manifest.files.every((file) => file.sha256.match(/^[a-f0-9]{64}$/))).toBe(true)
  })
  ```

- [ ] **Step 4: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test/adapter.test.ts test/server.test.ts test/electron-vite.test.ts test/snapshot.test.ts test/manifest.test.ts
  ```

  Expected: FAIL because old adapter lists/rules/ledger schema still exist.

- [ ] **Step 5: Implement convergence**

  Split the adapter so `VersionAdapter.modules` is the source for fingerprints, pre-transform targets, required build targets, output audit and ledger expectations. Keep only static locale/product-name and asset/logo transformations. Server Bun build and Electron Vite plugin must emit the same ledger event shape. Snapshot manifest must cover framework/config/resources, not just visual files.

- [ ] **Step 6: Add failure report and symbol evidence**

  Add tests that a controlled failed build writes a failure report with `stage`, `code`, `message`, `cause`, `stack`, Git/Profile/framework/adapter digests, last module, ledger path and sourcemap/symbol bundle path. Assert it does not contain API keys or configured Provider credentials.

- [ ] **Step 7: Run GREEN and brand compatibility audit**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test
  bun run lint
  bun run build -- --channel dev --audit-only
  ```

  If `--audit-only` does not exist yet, implement it in this task as a no-package build compatibility audit that compiles server/Electron and scans outputs without producing a release artifact.

- [ ] **Step 8: Commit**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "refactor(build): 收敛产品 Profile 构建框架"
  ```

### Task 6: Portable Runtime Acceptance and History Reconstruction

**Files:**

- Modify: `xcode/build/bluedcode/common/electron-builder.ts`
- Modify: `xcode/build/bluedcode/common/runtime-acceptance.ts`
- Modify: `xcode/build/bluedcode/common/release.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/build.ts`
- Test: `xcode/build/bluedcode/test/electron-builder.test.ts`
- Test: `xcode/build/bluedcode/test/runtime-acceptance.test.ts`
- Test: `xcode/build/bluedcode/test/release.test.ts`
- Test: `xcode/build/bluedcode/test/manifest.test.ts`
- Modify after validation: root `docs/origin-specs/01-product-branding.md`
- Modify after validation: root `docs/origin-specs/02-enterprise-product-policy.md`
- Modify after validation: root `docs/origin-specs/07-product-profile-architecture.md`

**Interfaces:**

- Consumes: completed source Profile behavior, build framework, Git state.
- Produces: dev/prod Windows x64 Portable EXE, exact `release-manifest.json`, runtime acceptance evidence, final two-commit history.

- [ ] **Step 1: RED for product version display**

  Add `runtime-acceptance.test.ts`:

  ```ts
  test("prod visible version uses full release identity", () => {
    expect(formatVisibleVersion({ opencodeVersion: "1.18.18", release: "260816-01", commit: "a39a781eb3" })).toBe(
      "1.18.18-260816-01-a39a781eb3",
    )
  })
  ```

- [ ] **Step 2: RED for runtime smoke gates**

  Add fixture tests for:

  ```ts
  test("fresh profile startup has no main-process JavaScript error", async () => {
    const result = await runPortableSmokeFixture({ configHome: fixtureConfigHome("valid-admin-provider") })
    expect(result.mainProcessError).toBeUndefined()
    expect(result.loadedModel).toBe("openai-proxy/gpt-4.1")
  })

  test("stale session not found is isolated to session recovery and does not crash the app shell", async () => {
    const result = await runPortableSmokeFixture({ sessionState: "stale" })
    expect(result.appShellLoaded).toBe(true)
    expect(result.recoveryError?.code).toBe("SESSION_NOT_FOUND")
  })
  ```

- [ ] **Step 3: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test/runtime-acceptance.test.ts test/electron-builder.test.ts test/release.test.ts test/manifest.test.ts
  ```

- [ ] **Step 4: Implement runtime acceptance and final package audit**

  Ensure dev and prod Portable use Profile identity, exact Windows x64 Portable output, unsigned PE evidence, ASAR/native exact, final EXE extraction audit, complete manifest stages and safe diagnostic bundle. Runtime acceptance must launch the built Portable in an isolated home/userData area, load `.config/bluedcode` admin Provider/model, verify V1/V2 switch, verify disabled entries, verify Deep Link registration refresh after moving the Portable, and confirm no public network/update/share calls occur.

- [ ] **Step 5: Run full validation**

  Run package checks from each package touched:

  ```bash
  cd packages/product
  bun test
  bun typecheck
  cd ../core
  bun test test/project-directories.test.ts
  bun typecheck
  cd ../desktop
  bun test src/main/product-identity.test.ts src/main/product-capability.test.ts src/renderer/initialization.test.ts
  bun typecheck
  cd ../opencode
  bun test test/product/provider-policy.test.ts test/product/config-policy.test.ts test/product/network-policy.test.ts
  bun typecheck
  cd ../app
  bun test src/product/capabilities.test.ts src/pages/providers.test.tsx src/pages/settings.test.tsx src/desktop-menu.test.ts
  bun typecheck
  cd ../../xcode/build/bluedcode
  bun test
  bun run lint
  bun run build -- --channel dev
  bun run build -- --channel prod --release 260816-01
  ```

  Expected: all package tests/typechecks PASS; dev and prod Portable build; prod visible version is `1.18.18-260816-01-<10位当前提交>`; final manifest has Profile, framework, adapter, source, server, main, preload, renderer, assets, package, portable and runtime evidence.

- [ ] **Step 6: Commit validation changes**

  ```bash
  git add packages/product packages/core packages/desktop packages/opencode packages/app xcode/build/bluedcode
  git commit -m "test(build): 验收 BluedCode 产品 Profile 产物"
  ```

- [ ] **Step 7: Reconstruct subrepo history**

  Create safety refs before rewriting:

  ```bash
  git branch safety/product-profile-before-rewrite
  git rev-parse origin/dev-foreachcode-1.18.18
  ```

  Rebuild from `v1.18.18` into exactly two semantic commits:

  ```text
  feat(product): 实现 BluedCode 产品与桌面构建
  feat(enterprise): 实现 BluedCode 企业产品策略
  ```

  The first commit contains `@foreachcode/product`, ORIGIN-01 source behavior, retained brand build/resources, build framework convergence and specs. The second commit contains ORIGIN-02 server/app enterprise behavior and tests. No `.xcode`, failure evidence, artifacts, user ignored paths or temporary plans enter either commit.

- [ ] **Step 8: Final review, push and root matrix updates**

  Run final whole-branch review before push. If clean, use:

  ```bash
  git push --force-with-lease origin dev-foreachcode-1.18.18
  ```

  After subrepo push, update root origin matrices only with the final commit ID that fully satisfies each origin spec. Commit root separately with Chinese message and update the submodule pointer.
