# BluedCode 企业内部化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 OpenCode 1.18.18 上游受跟踪源码的前提下，把 BluedCode Windows x64 Desktop Portable 构建为企业内部发行。

**Architecture:** 复用现有 `xcode/build/bluedcode` 非侵入构建框架，把企业策略作为 1.18.18 版本适配器的一组受控 AST/文本转换和最终产物审计。所有行为变化发生在 `.xcode/bluedcode/**` 的派生源码和 bundle 中；`packages/**`、lockfile、workspace 配置和依赖安装结果保持只读。

**Tech Stack:** Bun 1.3、TypeScript Compiler API、Electron Vite 5、Vite/Rollup pre-transform、Electron Builder、Bun test、现有 BluedCode audit/manifest/portable 审计框架

**Spec:** `docs/superpowers/specs/2026-08-16-02-enterprise-product-policy-design.md`（对应根仓 `docs/origin-specs/02-enterprise-product-policy.md` / `ORIGIN-02`）

## Global Constraints

- 基线必须是 OpenCode tag `v1.18.18`，基线提交必须是 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`，实现分支必须是 `dev-foreachcode-1.18.18`。
- 依赖 `ORIGIN-01` 已完成的 BluedCode Windows x64 Desktop Portable 构建；不得回退品牌、默认 V1 布局、版本号、Deep Link、AppData/server XDG 数据隔离或 CLI/Web/TUI 剔除。
- 只允许修改 `docs/superpowers/**` 与 `xcode/build/bluedcode/**`；不得修改 `packages/**`、`bun.lock`、根 workspace 配置、`node_modules` 或上游构建脚本。
- 企业策略固定启用，普通用户、环境变量、LocalStorage、server config、HTTP API 和构建参数均不能关闭。
- 企业 Provider 模式固定为 `admin-static-only`：只有管理员静态配置声明的 Provider 和模型可见可用。
- `/provider/auth` 必须返回空方法集合；OAuth authorize/callback、API key 写入、自定义 Provider 写入和 Auth 写入必须在网络请求与持久化前失败。
- 公开分享、自动分享和取消公开分享必须在服务边界失败或安全 no-op，不得调用公共 Share 服务，不得写入 session share URL。
- updater、publish、Sentry、公共 trace/exporter、公共 changelog、反馈和 GitHub issue 公共入口必须不可由最终 Desktop 产物触发。
- 允许保留 `OPENCODE_*`、`@opencode-ai/*`、内部 server OAuth client ID、包名、license、注释和已审计的服务身份，但必须进入 allowlist。
- 所有转换必须由受控文件指纹、语义选择器、精确命中数和 ledger 记录保护；禁止无边界全局字符串替换。
- 所有新增行为必须按 TDD：先写聚焦测试并确认 RED，再写最小实现，再运行聚焦测试和任务级完整测试。
- 根仓和子仓分别提交，所有 commit 摘要与正文必须使用中文。

---

### Task 1: 企业策略合同与公共审计能力

**Files:**

- Create: `xcode/build/bluedcode/common/enterprise.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-policy.ts`
- Modify: `xcode/build/bluedcode/common/audit.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Test: `xcode/build/bluedcode/test/enterprise.test.ts`
- Test: `xcode/build/bluedcode/test/audit.test.ts`
- Test: `xcode/build/bluedcode/test/build.test.ts`

**Interfaces:**

- Consumes: existing `BuildIdentity`, `AuditPolicy`, `AuditReport`, `adapter11818`.
- Produces:
  - `EnterprisePolicy = { enabled: true; providerMode: "admin-static-only"; blockedAuthWrites: true; blockedPublicShare: true; blockedPublicCatalogRefresh: true; blockedTelemetry: true; blockedPublicUpdates: true; blockedPublicProductLinks: true }`
  - `enterprisePolicy11818: EnterprisePolicy`
  - `mergeAuditPolicies(...policies: readonly AuditPolicy[]): AuditPolicy`
  - manifest field `enterprise: { policy: EnterprisePolicy; audit: AuditReport }`

- [ ] **Step 1: Write RED tests for immutable enterprise policy**

  Add `xcode/build/bluedcode/test/enterprise.test.ts`:

  ```ts
  import { describe, expect, test } from "bun:test"
  import { assertEnterprisePolicy, enterprisePolicySchema } from "../common/enterprise"
  import { enterprisePolicy11818 } from "../version/1.18.18/rules/enterprise-policy"

  describe("Enterprise policy", () => {
    test("BluedCode 1.18.18 policy is always enabled and admin-static-only", () => {
      expect(assertEnterprisePolicy(enterprisePolicy11818)).toEqual({
        enabled: true,
        providerMode: "admin-static-only",
        blockedAuthWrites: true,
        blockedPublicShare: true,
        blockedPublicCatalogRefresh: true,
        blockedTelemetry: true,
        blockedPublicUpdates: true,
        blockedPublicProductLinks: true,
      })
    })

    test("policy cannot be disabled or widened by user input", () => {
      expect(() => enterprisePolicySchema.parse({ ...enterprisePolicy11818, enabled: false })).toThrow("enabled")
      expect(() => enterprisePolicySchema.parse({ ...enterprisePolicy11818, providerMode: "user-configurable" })).toThrow(
        "providerMode",
      )
    })
  })
  ```

- [ ] **Step 2: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test/enterprise.test.ts
  ```

  Expected: FAIL because `common/enterprise` and `enterprise-policy` exports do not exist.

- [ ] **Step 3: Implement minimal policy schema and policy export**

  Implement `common/enterprise.ts` without external dependencies:

  ```ts
  export type EnterprisePolicy = {
    enabled: true
    providerMode: "admin-static-only"
    blockedAuthWrites: true
    blockedPublicShare: true
    blockedPublicCatalogRefresh: true
    blockedTelemetry: true
    blockedPublicUpdates: true
    blockedPublicProductLinks: true
  }

  export const enterprisePolicySchema = {
    parse(input: unknown): EnterprisePolicy {
      if (!input || typeof input !== "object") throw new Error("enterprise policy 必须是对象")
      const value = input as Record<string, unknown>
      const exact: EnterprisePolicy = {
        enabled: true,
        providerMode: "admin-static-only",
        blockedAuthWrites: true,
        blockedPublicShare: true,
        blockedPublicCatalogRefresh: true,
        blockedTelemetry: true,
        blockedPublicUpdates: true,
        blockedPublicProductLinks: true,
      }
      for (const [key, expected] of Object.entries(exact)) {
        if (value[key] !== expected) throw new Error(`enterprise policy ${key} 必须固定为 ${String(expected)}`)
      }
      return exact
    },
  }

  export function assertEnterprisePolicy(input: unknown) {
    return enterprisePolicySchema.parse(input)
  }
  ```

  Export `enterprisePolicy11818` from `version/1.18.18/rules/enterprise-policy.ts` by calling `assertEnterprisePolicy`.

- [ ] **Step 4: Add audit policy composition tests and implementation**

  Extend `audit.test.ts`:

  ```ts
  test("合并品牌与企业审计 policy 时拒绝重复 allowance id", () => {
    const one = { tokens: ["https://opencode.ai"], allow: [{ id: "same", path: "**/*.js", token: "x", expected: 1, classification: "preserved", reason: "a" }] } as const
    const two = { tokens: ["SENTRY_DSN"], allow: [{ id: "same", path: "**/*.js", token: "y", expected: 1, classification: "preserved", reason: "b" }] } as const
    expect(() => mergeAuditPolicies(one, two)).toThrow("重复 allowance id")
  })
  ```

  Implement `mergeAuditPolicies` in `common/audit.ts`: de-duplicate tokens by literal value while preserving stable sort, and throw if two allowances share the same `id`.

- [ ] **Step 5: Add manifest enterprise field test and implementation**

  Extend `build.test.ts` manifest fixture to require:

  ```ts
  expect(manifest.enterprise.policy.providerMode).toBe("admin-static-only")
  expect(manifest.enterprise.audit.passed).toBe(true)
  ```

  Extend `common/manifest.ts` schema/writer so release manifests carry the exact enterprise policy and audit report.

- [ ] **Step 6: Run GREEN**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test/enterprise.test.ts test/audit.test.ts test/build.test.ts
  bunx oxlint common/enterprise.ts common/audit.ts common/manifest.ts version/1.18.18/rules/enterprise-policy.ts test/enterprise.test.ts test/audit.test.ts test/build.test.ts
  bunx prettier --check common/enterprise.ts common/audit.ts common/manifest.ts version/1.18.18/rules/enterprise-policy.ts test/enterprise.test.ts test/audit.test.ts test/build.test.ts
  ```

  Expected: all tests pass, lint has 0 warnings and 0 errors, Prettier passes.

- [ ] **Step 7: Commit**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 增加企业策略合同与审计基础"
  ```

### Task 2: Provider/Auth 企业收束

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-provider.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/baseline.json`
- Modify: `xcode/build/bluedcode/test/build.test.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`

**Interfaces:**

- Consumes: Task 1 `enterprisePolicy11818`; existing adapter `transform(file, code, identity)`.
- Produces:
  - `enterpriseProviderTargets: readonly string[]`
  - `transformEnterpriseProvider(file: string, code: string): TransformResult`
  - final provider API behavior in derived server bundle:
    - `/provider` only returns admin-static config providers
    - `/provider/auth` returns `{}`
    - OAuth authorize/callback throw before network or Auth writes

- [ ] **Step 1: Write RED adapter tests for Provider/Auth transforms**

  Add to `version/1.18.18/tests/adapter.test.ts`:

  ```ts
  test("企业 Provider 只允许管理员静态配置且 auth 入口为空", async () => {
    const output = await applyTrackedFixtures(adapter11818, prodIdentity)
    expect(output["packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts"]).toContain(
      "BluedCodeEnterpriseProviderHttpApi.list",
    )
    expect(output["packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts"]).toContain("return {}")
    expect(output["packages/opencode/src/provider/auth.ts"]).toContain("BluedCodeEnterpriseProviderAuth.disabled")
    expect(output["packages/opencode/src/provider/provider.ts"]).toContain("admin-static-only")
  })
  ```

  Add to `fail-closed.test.ts`:

  ```ts
  test("Provider/Auth 企业入口删除、复制或改名时 fail closed", () => {
    expect(() => adapter11818.transform("packages/opencode/src/provider/auth.ts", sourceWithoutAuthorize, prodIdentity)).toThrow(
      "企业 Provider",
    )
    expect(() => adapter11818.transform("packages/opencode/src/provider/auth.ts", sourceWithDuplicatedAuthorize, prodIdentity)).toThrow(
      "企业 Provider",
    )
  })
  ```

- [ ] **Step 2: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts -t "企业 Provider|Provider/Auth"
  ```

  Expected: FAIL because provider/auth files are not yet controlled and transformed.

- [ ] **Step 3: Implement `enterprise-provider.ts` with AST transforms**

  Control these files with exact fingerprints:

  ```text
  packages/opencode/src/provider/provider.ts
  packages/opencode/src/provider/auth.ts
  packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts
  packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts
  packages/app/src/components/settings-providers.tsx
  packages/app/src/components/settings-v2/providers.tsx
  packages/app/src/components/dialog-connect-provider.tsx
  packages/app/src/components/dialog-custom-provider.tsx
  packages/app/src/components/dialog-manage-models.tsx
  packages/app/src/hooks/use-providers.ts
  packages/app/src/hooks/provider-catalog.ts
  ```

  Required derived behavior:

  - provider list filters to config providers only;
  - environment source, Auth source, OAuth source, plugin Auth hook and public catalog recommendation do not create available providers;
  - Provider auth methods returns `{}`;
  - authorize/callback fail with stable message `BluedCode enterprise policy disables provider credential changes`;
  - settings UI renders connected/admin providers only and does not render connect/custom/disconnect controls.

  Each transform record ID must start with `enterprise.provider.`.

- [ ] **Step 4: Add focused unit tests for derived snippets**

  In adapter tests, evaluate transformed code as text:

  ```ts
  expect(transformed).not.toContain("popularProviders")
  expect(transformed).not.toContain("<DialogConnectProvider")
  expect(transformed).not.toContain("<DialogCustomProvider")
  expect(transformed).not.toContain(".client.auth.remove")
  expect(transformed).not.toContain("method.authorize(")
  expect(transformed).not.toContain("auth.set(")
  ```

  Add positive checks for preserved admin config:

  ```ts
  expect(transformedProvider).toContain("config.provider")
  expect(transformedProvider).toContain("source: \"config\"")
  ```

- [ ] **Step 5: Run GREEN and build smoke subset**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/plugins.test.ts
  bun test test/electron-vite.test.ts -t "真实 compile smoke|未分类"
  bunx oxlint version/1.18.18/rules/enterprise-provider.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts
  bunx prettier --check version/1.18.18/rules/enterprise-provider.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts
  ```

  Expected: all selected tests pass and tracked `packages/**` remains unchanged.

- [ ] **Step 6: Commit**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 收束企业 Provider 与认证入口"
  ```

### Task 3: 分享、自动分享与公开链接禁用

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-share.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/baseline.json`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`
- Modify: `xcode/build/bluedcode/test/build.test.ts`

**Interfaces:**

- Consumes: existing adapter flow and Task 1 enterprise policy.
- Produces:
  - `enterpriseShareTargets: readonly string[]`
  - `transformEnterpriseShare(file: string, code: string): TransformResult`
  - final bundle has no user-triggerable public share creation path.

- [ ] **Step 1: Write RED tests for server share boundary**

  Add to `adapter.test.ts`:

  ```ts
  test("企业发行禁止公开分享且忽略 autoShare", async () => {
    const output = await applyTrackedFixtures(adapter11818, prodIdentity)
    const share = output["packages/opencode/src/share/session.ts"]
    expect(share).toContain("BluedCodeEnterpriseShare.disabled")
    expect(share).not.toContain("shareNext.create(sessionID)")
    expect(share).not.toContain("session.setShare({ sessionID, share: { url: result.url } })")
    expect(share).not.toContain("flags.autoShare || conf.share === \"auto\"")
  })
  ```

  Add to `fail-closed.test.ts` a source mutation that duplicates `ShareNext.create` and expects an enterprise share transform error.

- [ ] **Step 2: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts -t "分享|Share"
  ```

  Expected: FAIL because `packages/opencode/src/share/session.ts` is not transformed.

- [ ] **Step 3: Implement share transforms**

  Control and transform:

  ```text
  packages/opencode/src/share/session.ts
  packages/opencode/src/server/routes/instance/httpapi/groups/session.ts
  packages/app/src/pages/session/timeline/message-timeline.tsx
  ```

  Required derived behavior:

  - `share()` throws `BluedCode enterprise policy disables public session sharing` before `ShareNext.create`;
  - `unshare()` returns without calling `ShareNext.remove`;
  - `create()` never forks auto-share;
  - session share/unshare OpenAPI descriptions and endpoints are not user-visible in Desktop bundle or are stable-disabled;
  - renderer timeline does not render publish/unpublish/copy public link controls.

  Each transform record ID must start with `enterprise.share.`.

- [ ] **Step 4: Add final output audit tokens**

  Extend enterprise audit policy so final output fails on unclassified occurrences of:

  ```text
  session.share
  session.unshare
  shareNext.create
  shareNext.remove
  session.share.action.publish
  session.share.action.unpublish
  ```

  Allow only inert schema/translation residues that are not reachable in Desktop, with exact path and count.

- [ ] **Step 5: Run GREEN**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/build.test.ts -t "分享|Share|enterprise"
  bun test test/electron-vite.test.ts -t "真实 compile smoke|未分类"
  bunx oxlint version/1.18.18/rules/enterprise-share.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/build.test.ts
  bunx prettier --check version/1.18.18/rules/enterprise-share.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/build.test.ts
  ```

  Expected: all selected tests pass and no tracked `packages/**` modifications.

- [ ] **Step 6: Commit**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 禁用企业公开分享入口"
  ```

### Task 4: 更新、遥测与公共产品入口禁用

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/rules/enterprise-public-surface.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/baseline.json`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`
- Modify: `xcode/build/bluedcode/test/build.test.ts`
- Modify: `xcode/build/bluedcode/test/electron-vite.test.ts`

**Interfaces:**

- Consumes: Task 1 enterprise audit policy and existing ORIGIN-01 updater/Sentry exclusions.
- Produces:
  - `enterprisePublicSurfaceTargets: readonly string[]`
  - `transformEnterprisePublicSurface(file: string, code: string): TransformResult`
  - final bundle cannot trigger public updater, Sentry, changelog, feedback or upstream GitHub issue links.

- [ ] **Step 1: Write RED tests for public surface transforms**

  Add to `adapter.test.ts`:

  ```ts
  test("企业发行禁用更新、遥测、changelog 和反馈入口", async () => {
    const output = await applyTrackedFixtures(adapter11818, prodIdentity)
    expect(output["packages/desktop/src/main/index.ts"]).not.toContain("setupAutoUpdater(")
    expect(output["packages/desktop/src/main/index.ts"]).not.toContain("setInterval(() => void updater.check()")
    expect(output["packages/desktop/src/preload/index.ts"]).not.toContain('ipcRenderer.invoke("updater-check")')
    expect(output["packages/desktop/src/renderer/index.tsx"]).not.toContain("Sentry.init(")
    expect(output["packages/app/src/context/highlights.tsx"]).not.toContain("https://opencode.ai/changelog.json")
    expect(output["packages/app/src/desktop-menu.ts"]).not.toContain("github.com/anomalyco/opencode/issues")
  })
  ```

- [ ] **Step 2: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts -t "更新|遥测|changelog|反馈"
  ```

  Expected: FAIL because some public surface transforms are missing.

- [ ] **Step 3: Implement public surface transforms**

  Control and transform:

  ```text
  packages/desktop/src/main/index.ts
  packages/desktop/src/main/ipc.ts
  packages/desktop/src/preload/index.ts
  packages/desktop/src/preload/types.ts
  packages/desktop/src/renderer/index.tsx
  packages/app/src/entry.tsx
  packages/app/src/app.tsx
  packages/app/src/context/highlights.tsx
  packages/app/src/desktop-menu.ts
  packages/app/src/components/settings-general.tsx
  packages/app/src/components/settings-v2/general.tsx
  packages/app/src/components/titlebar.tsx
  ```

  Required derived behavior:

  - no `setupAutoUpdater`, `updater.start`, timer-driven update checks, `showUpdaterDialog`, update IPC handler or update install invocation;
  - preload updater object either absent from reachable Desktop platform or returns disabled-only methods;
  - renderer does not call `Sentry.init` or `Sentry.captureException` for remote telemetry;
  - Sentry imports are removed or rewritten to local no-op bindings;
  - changelog and feedback links are removed from menus/highlights/settings;
  - settings General and V2 General do not render update sections.

  Each transform record ID must start with `enterprise.publicSurface.`.

- [ ] **Step 4: Extend final output audit**

  Add enterprise audit tokens:

  ```text
  https://opencode.ai/changelog.json
  github.com/anomalyco/opencode
  sentry.io
  SENTRY_DSN
  OTEL_EXPORTER
  updater-check
  updater-install
  latest.yml
  latest.json
  ```

  For each token, either final output contains zero occurrences or an exact allowlist explains a non-reachable build-time residue.

- [ ] **Step 5: Run GREEN**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/electron-vite.test.ts test/build.test.ts -t "更新|遥测|changelog|反馈|真实 compile smoke|enterprise"
  bunx oxlint version/1.18.18/rules/enterprise-public-surface.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/build.test.ts test/electron-vite.test.ts
  bunx prettier --check version/1.18.18/rules/enterprise-public-surface.ts version/1.18.18/index.ts version/1.18.18/tests/adapter.test.ts version/1.18.18/tests/fail-closed.test.ts test/build.test.ts test/electron-vite.test.ts
  ```

  Expected: all selected tests pass and no tracked `packages/**` modifications.

- [ ] **Step 6: Commit**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 禁用企业公共产品入口"
  ```

### Task 5: 端到端审计、manifest、文档与产物验收

**Files:**

- Modify: `xcode/build/bluedcode/build.ts`
- Modify: `xcode/build/bluedcode/common/manifest.ts`
- Modify: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Modify: `xcode/build/bluedcode/test/build.test.ts`
- Modify: `xcode/build/bluedcode/test/typecheck.test.ts`
- Modify: `docs/superpowers/specs/2026-08-16-02-enterprise-product-policy-design.md`
- Modify: `docs/superpowers/plans/2026-08-16-enterprise-product-policy.md`

**Interfaces:**

- Consumes: Tasks 1-4 enterprise transforms and audit policies.
- Produces:
  - final build manifest with enterprise policy, enterprise audit, transform ledger, source certification and artifact hash;
  - `bun xcode/build/bluedcode/build.ts --channel dev` succeeds for enterprise build;
  - optional prod package command remains `bun xcode/build/bluedcode/build.ts --channel prod --release YYMMDD-NN`.

- [x] **Step 1: Write RED end-to-end tests**

  Extend `build.test.ts`:

  ```ts
  test("最终 manifest 记录企业策略且公共能力审计通过", async () => {
    const manifest = await readManifestFixture()
    expect(manifest.enterprise.policy).toEqual(enterprisePolicy11818)
    expect(manifest.enterprise.audit.passed).toBe(true)
    expect(manifest.audits.output.unclassified).toEqual([])
    expect(manifest.artifact.name).toMatch(/^BluedCode(-Dev)?-1\.18\.18-/)
  })
  ```

  Extend the output audit fixture so a bundle containing `SENTRY_DSN`, `updater-check`, `github.com/anomalyco/opencode`, `shareNext.create`, or `method.authorize(` fails with `AuditError`.

- [x] **Step 2: Run RED**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test/build.test.ts -t "enterprise|公共能力审计|manifest"
  ```

  Expected: FAIL because final manifest/build audit is not fully wired.

- [x] **Step 3: Wire enterprise audit into build pipeline**

  In `build.ts`:

  - merge brand audit and enterprise audit before output scan;
  - include enterprise transform ledger records in final ledger;
  - store `enterprise.policy` and `enterprise.audit` in manifest;
  - fail before publish if output audit has any unclassified public capability token;
  - preserve existing source before/after Git certification.

- [x] **Step 4: Update spec implementation result section**

  Append to `docs/superpowers/specs/2026-08-16-02-enterprise-product-policy-design.md` an implementation result section containing:

  ```text
  ## 14. 1.18.18 实施结果

  本节在实现完成后记录最终 commit、测试、dev/prod 产物、企业策略审计摘要和未作为本轮阻塞的事项。
  ```

  Replace that exact text with real commit, tests and artifact evidence only after verification commands pass.

- [x] **Step 5: Run full verification**

  Run from `xcode/build/bluedcode`:

  ```bash
  bun test test version/1.18.18/tests
  bunx oxlint common version/1.18.18 test build.ts
  bunx prettier --check common version/1.18.18 test build.ts ../../docs/superpowers/specs/2026-08-16-02-enterprise-product-policy-design.md ../../docs/superpowers/plans/2026-08-16-enterprise-product-policy.md
  ```

  Run from repo root:

  ```bash
  git diff --check
  git status --short
  ```

  Expected: all BluedCode tests pass; task files lint with 0 errors; Prettier passes; `git diff --check` has no whitespace errors; `git status --short` shows no tracked `packages/**` modifications.

- [x] **Step 6: Build current dev artifact**

  Run from repo root:

  ```bash
  bun xcode/build/bluedcode/build.ts --channel dev
  ```

  Expected: exit 0, generated artifact name is `BluedCode-Dev-1.18.18-dev-<10位commit>-windows-x64-portable.exe`, manifest contains `enterprise.policy.providerMode = "admin-static-only"` and output audit passes.

- [x] **Step 7: Commit**

  ```bash
  git add xcode/build/bluedcode docs/superpowers/specs/2026-08-16-02-enterprise-product-policy-design.md docs/superpowers/plans/2026-08-16-enterprise-product-policy.md
  git commit -m "feat(build): 完成企业内部化构建验收"
  ```

---

## Self-Review Checklist

- Spec coverage: Task 1 covers immutable policy and manifest schema; Task 2 covers Provider/Auth; Task 3 covers share; Task 4 covers updater/telemetry/public links; Task 5 covers final audit, docs and package compatibility.
- Non-intrusion: every task only touches `docs/superpowers/**` or `xcode/build/bluedcode/**`; each task requires checking that tracked `packages/**` remains unchanged.
- TDD: every task starts with RED tests, then implementation, then focused GREEN and commit.
- Build compatibility: Task 5 requires full `ORIGIN-01` BluedCode tests and dev package verification after enterprise changes.
