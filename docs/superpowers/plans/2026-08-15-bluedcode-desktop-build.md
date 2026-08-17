# BluedCode Windows Desktop 品牌构建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 OpenCode 1.18.18 已跟踪上游源码的前提下，构建可复现、可审计的 BluedCode Windows x64 单文件 Portable EXE。

**Architecture:** 在 `xcode/build/bluedcode/` 增加通用构建内核和按 tag 拆分的 1.18.18 适配器。构建内核只读 Git 跟踪源码和现有依赖，通过 Vite/Rollup 的内存转换、隔离的 server bundle 与 Electron Builder 配置生成产物；所有缓存、中间文件和产物位于 `.xcode/`，不回写 `packages/**`。根仓保存可跨版本分发的公共内核与品牌资源，子仓保存一份可独立构建的严格快照和版本适配器。

**Tech Stack:** Bun 1.x、TypeScript Compiler API、Electron Vite 5、Vite/Rollup、Electron Builder、Bun test、PowerShell/Windows Registry（运行验收）

**Spec:** `docs/superpowers/specs/2026-08-15-01-product-branding-design.md`（对应根仓 `docs/origin-specs/01-product-branding.md` / `ORIGIN-01`）

## Global Constraints

- 基线必须是 OpenCode tag `v1.18.18`，基线提交必须是 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`，实现分支必须是 `dev-foreachcode-1.18.18`。
- 只支持 Windows x64 Desktop；只产出 Electron Builder `portable` 单文件 EXE，不产出 CLI、Web、TUI、NSIS、MSI、ZIP、Store、macOS、Linux 或 ARM64 产品。
- `prod` 身份固定为 `BluedCode` / `ai.bluedcode.desktop` / `bluedcode://`；`dev` 固定为 `BluedCode Dev` / `ai.bluedcode.desktop.dev` / `bluedcode-dev://`。
- 用户数据分别位于 `%APPDATA%\ai.bluedcode.desktop` 和 `%APPDATA%\ai.bluedcode.desktop.dev`；不得读取、迁移或删除 OpenCode 或另一 channel 的数据。
- 内部 `.opencode`、`opencode.json(c)`、`OPENCODE_*`、`@opencode-ai/*`、provider/API/service 名称保持不变。
- updater、publish、Sentry 上传与代码签名必须关闭；Portable EXE 必须标识可能触发 Windows SmartScreen“未知发布者”。
- 正式版本格式为 `1.18.18-YYMMDD-NN-<10位子仓提交>`，产物为 `BluedCode-1.18.18-YYMMDD-NN-<10位子仓提交>-windows-x64-portable.exe`；dev 不消耗发行序号。
- 正式 tag 格式为 `bluedcode-v1.18.18-YYMMDD-NN`；同日 `NN` 跨 OpenCode 小版本全局递增，tag 与 release 文案使用中文。
- 禁止全文件、bundle、ASAR 或 EXE 的无边界 `OpenCode -> BluedCode` 替换；每条转换必须有语义选择器、原值、目标值和精确命中数。
- 现有 Git 跟踪的 `packages/**`、根配置和上游构建脚本不得修改；若实现发现必须修改，立即停止并报告用户。
- `packages/brand/` 和 `packages/opencode/script/build-config.ts` 是 ignored 遗留 overlay，不得读取、复制或进入缓存键、转换输入、构建图和产物；按用户 2026-08-16 “放宽一点”的裁决，它们不再作为本轮本地 prod 构建阻塞项。
- `node_modules` 只读复用且不得复制；所有派生文件、缓存、bundle、stage、审计报告和产物写入子仓 `.xcode/bluedcode/`。
- 根仓公共资源是跨版本来源；子仓不得使用父级相对路径或符号链接，必须包含逐文件 SHA-256 快照。`tui.json` 参与快照校验，但不得进入 Desktop 视觉摘要、缓存或产物。
- 所有新增行为必须按 TDD：先运行聚焦测试并记录预期失败，再写最小实现，再运行聚焦测试和任务级完整测试。
- 根仓和子仓分别提交，所有 commit 摘要与正文使用中文。

---

### Task 1: 构建合同、版本参数与公共快照

**Files:**

- Create: `xcode/build/bluedcode/common/types.ts`
- Create: `xcode/build/bluedcode/common/config.ts`
- Create: `xcode/build/bluedcode/common/git.ts`
- Create: `xcode/build/bluedcode/common/snapshot.ts`
- Create: `xcode/build/bluedcode/brand.json`
- Create: `xcode/build/bluedcode/app-icon.svg`
- Create: `xcode/build/bluedcode/app-icon.png`
- Create: `xcode/build/bluedcode/wordmark.svg`
- Create: `xcode/build/bluedcode/tui.json`
- Create: `xcode/build/bluedcode/snapshot-manifest.json`
- Test: `xcode/build/bluedcode/test/config.test.ts`
- Test: `xcode/build/bluedcode/test/snapshot.test.ts`

**Interfaces:**

- Consumes: 根仓 `../xcode/build/bluedcode/{brand.json,app-icon.svg,app-icon.png,wordmark.svg,tui.json}` 的字节内容；Git CLI。
- Produces: `parseBuildArgs(argv: string[]): BuildRequest`、`resolveBuildIdentity(request, git): BuildIdentity`、`assertTrackedBaseline(git): Promise<void>`、`verifySnapshot(root): Promise<SnapshotManifest>`；`BuildRequest = { channel: "dev" | "prod"; release?: string }`。

- [ ] **Step 1: 复制公共品牌资源并写失败测试**

  逐文件复制根仓五个公共文件到子仓；测试只读取副本，不允许在运行时回退到父目录：

  ```ts
  test("prod 必须显式给出 YYMMDD-NN", () => {
    expect(() => parseBuildArgs(["--channel", "prod"])).toThrow("--release")
    expect(parseBuildArgs(["--channel", "prod", "--release", "260815-01"])).toEqual({
      channel: "prod",
      release: "260815-01",
    })
  })

  test("拒绝 beta、非 Windows x64 和伪造 commit", () => {
    expect(() => parseBuildArgs(["--channel", "beta"])).toThrow("dev 或 prod")
    expect(() => parseBuildArgs(["--channel", "dev", "--commit", "deadbeef"])).toThrow("未知参数")
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/config.test.ts ./xcode/build/bluedcode/test/snapshot.test.ts`

  Expected: FAIL，提示 `config.ts` / `snapshot.ts` 不存在或导出不存在。

- [ ] **Step 3: 实现严格参数、Git 基线和快照校验**

  ```ts
  export type BuildRequest = { channel: "dev" | "prod"; release?: string }
  export type BuildIdentity = {
    channel: "dev" | "prod"
    name: "BluedCode" | "BluedCode Dev"
    appId: "ai.bluedcode.desktop" | "ai.bluedcode.desktop.dev"
    protocol: "bluedcode" | "bluedcode-dev"
    version: string
    commit: string
    shortCommit: string
    artifactName: string
    tag?: string
  }
  ```

  `snapshot-manifest.json` 固定记录 framework version `1`、五个相对路径与小写 SHA-256。`verifySnapshot` 对缺失、多余、hash 不同均失败；`tui.json` 仅在这里出现。

- [ ] **Step 4: 运行 GREEN 与完整任务测试**

  Run: `bun test ./xcode/build/bluedcode/test/config.test.ts ./xcode/build/bluedcode/test/snapshot.test.ts`

  Expected: PASS，输出无 warning；测试覆盖 dev/prod、日期格式、10/40 位 commit、dirty tracked/untracked、ignored overlay 不进入构建输入，以及删/增/改快照文件三种失败。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 建立 BluedCode 构建合同与资源快照"
  ```

### Task 2: 语义转换引擎与审计账本

**Files:**

- Create: `xcode/build/bluedcode/common/transform/types.ts`
- Create: `xcode/build/bluedcode/common/transform/typescript.ts`
- Create: `xcode/build/bluedcode/common/transform/html.ts`
- Create: `xcode/build/bluedcode/common/transform/text.ts`
- Create: `xcode/build/bluedcode/common/transform/engine.ts`
- Create: `xcode/build/bluedcode/common/audit.ts`
- Test: `xcode/build/bluedcode/test/transform.test.ts`
- Test: `xcode/build/bluedcode/test/audit.test.ts`

**Interfaces:**

- Consumes: `TransformRule` 声明与 Git 跟踪文件内容。
- Produces: `transformModule(input: TransformInput, rules: readonly TransformRule[]): TransformResult`、`writeTransformLedger(path, results)`、`scanOutput(root, policy): Promise<AuditReport>`。

- [ ] **Step 1: 写规则模型和失败测试**

  ```ts
  export type TransformRule = {
    id: string
    file: string
    kind: "ts-string" | "ts-remove-property" | "ts-remove-call" | "html-attribute" | "html-text" | "exact-text"
    selector: string
    from: string
    to?: string
    expected: number
    classification: "product" | "entrypoint" | "preserved"
    reason: string
  }

  test("删除、复制或改写目标时均 fail closed", () => {
    expect(() => transformModule(missing, [rule])).toThrow("命中 0，期望 1")
    expect(() => transformModule(duplicated, [rule])).toThrow("命中 2，期望 1")
    expect(() => transformModule(changed, [rule])).toThrow("原值不匹配")
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/transform.test.ts ./xcode/build/bluedcode/test/audit.test.ts`

  Expected: FAIL，缺少转换导出。

- [ ] **Step 3: 用 TypeScript Compiler API 实现精确转换**

  TypeScript 规则只允许命中 AST 字符串节点、对象属性或完整调用表达式；HTML 规则只允许命中指定 tag/attribute/text；`exact-text` 必须限定单一文件和完整原值。结果包含规则 ID、文件、命中数、转换前后 SHA-256，不允许正则全局替换。

  ```ts
  export type TransformResult = {
    code: string
    records: Array<{ id: string; file: string; hits: number; before: string; after: string }>
  }
  ```

  审计扫描使用按路径和语义分类的 allowlist；任何未分类 `OpenCode`、`opencode://`、CLI/WSL 用户入口或 Sentry/publish 标记都令构建失败。

- [ ] **Step 4: 运行 GREEN**

  Run: `bun test ./xcode/build/bluedcode/test/transform.test.ts ./xcode/build/bluedcode/test/audit.test.ts`

  Expected: PASS；测试同时证明 `OpenCode Zen`、`OPENCODE_*`、`@opencode-ai/*` 和 `.opencode` 被保留并记入白名单账本。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 增加语义转换引擎与品牌审计"
  ```

### Task 3: OpenCode 1.18.18 模块化适配器

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/index.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/baseline.json`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/identity.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/renderer.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/locales.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/assets.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/disable-cli.ts`
- Create: `xcode/build/bluedcode/version/1.18.18/rules/preserved-identities.ts`
- Test: `xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts`
- Test: `xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `TransformRule` 与 `transformModule`。
- Produces: `adapter11818: VersionAdapter`，其中 `VersionAdapter = { tag; commit; fingerprints; rules; auditPolicy; transform(file, code, identity) }`。

- [ ] **Step 1: 对真实 `v1.18.18` 文件写失败合同测试**

  ```ts
  test("身份、deep link、CLI/WSL/updater 入口被精确改写", async () => {
    const output = await applyTrackedFixtures(adapter11818, prodIdentity)
    expect(output.main).toContain('prod: "BluedCode"')
    expect(output.main).toContain('app.setAsDefaultProtocolClient("bluedcode"')
    expect(output.main).not.toContain("startBackgroundCli(")
    expect(output.preload).not.toContain("installCli:")
    expect(output.preload).not.toContain("wslServers:")
    expect(output.main).not.toContain("void updater.start()")
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/version/1.18.18/tests/adapter.test.ts ./xcode/build/bluedcode/version/1.18.18/tests/fail-closed.test.ts`

  Expected: FAIL，`adapter11818` 不存在。

- [ ] **Step 3: 实现小文件规则组合**

  精确覆盖 `packages/desktop/src/main/index.ts`、`windows.ts`、`ipc.ts`、`preload/index.ts`、`preload/types.ts`、`renderer/index.tsx`、`renderer/index.html`、`packages/app/src/desktop-menu.ts` 和相关 locale 模块。结构删除必须同时断言删除前节点存在且删除后入口不可达；保留内嵌 server v1 路径，禁止进入 `SIDECAR_VERSION === "v2"` 后台 CLI 路径；禁用 updater 初始化、定时器、菜单和 renderer 调用，但可提供类型兼容的本地 disabled state。

  `baseline.json` 记录受控文件的语义指纹，不记录绝对路径；`index.ts` 仅做组合，不堆放规则正文。

- [ ] **Step 4: 运行 GREEN 与故障注入测试**

  Run: `bun test ./xcode/build/bluedcode/version/1.18.18/tests`

  Expected: PASS；分别删除目标、复制目标、改变目标原值时失败；验证 dev/prod 两套身份、OpenCode 数据零迁移、CLI/WSL/updater 不可达、内部协议白名单不变。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode/version
  git commit -m "feat(build): 实现 OpenCode 1.18.18 品牌适配器"
  ```

### Task 4: 内容寻址缓存与隔离 server bundle

**Files:**

- Create: `xcode/build/bluedcode/common/cache.ts`
- Create: `xcode/build/bluedcode/common/paths.ts`
- Create: `xcode/build/bluedcode/common/server.ts`
- Test: `xcode/build/bluedcode/test/cache.test.ts`
- Test: `xcode/build/bluedcode/test/server.test.ts`

**Interfaces:**

- Consumes: Task 1 的 identity/snapshot，`packages/opencode/src/node.ts` 与 Task 3 adapter digest。
- Produces: `createBuildPaths(identity): BuildPaths`、`cacheKey(input): string`、`withCache<T>(unit, key, build): Promise<CacheResult<T>>`、`buildServer(paths, identity): Promise<ServerBundle>`。

- [ ] **Step 1: 写缓存隔离和只读保护失败测试**

  ```ts
  test("相同输入命中，channel 身份只使身份相关阶段失效", async () => {
    expect(cacheKey(serverDev)).toBe(cacheKey(serverProd))
    expect(cacheKey(rendererDev)).not.toBe(cacheKey(rendererProd))
  })

  test("server 只写 .xcode/bluedcode", async () => {
    await buildServer(paths, identity)
    expect(await trackedTreeDigest()).toBe(before)
    expect(paths.serverDir.startsWith(paths.workspaceRoot)).toBe(true)
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/cache.test.ts ./xcode/build/bluedcode/test/server.test.ts`

  Expected: FAIL，缺少缓存和 server builder。

- [ ] **Step 3: 实现原子缓存和外部 `Bun.build` wrapper**

  `buildServer` 复用 `packages/opencode/script/build-node.ts` 的 entry、target、format、sourcemap、external、define 和 generated model 数据语义，但直接调用 `Bun.build({ outdir: paths.serverDir })`，绝不 import 会写 `packages/opencode/dist/node` 的原脚本。缓存键包含 commit、`bun.lock`、Bun/Electron、平台架构、公共快照、适配器和输入摘要；写入先到临时目录再原子 rename。

- [ ] **Step 4: 运行 GREEN**

  Run: `bun test ./xcode/build/bluedcode/test/cache.test.ts ./xcode/build/bluedcode/test/server.test.ts`

  Expected: PASS；第二次相同 fixture 构建显示 cache hit，修改 `bun.lock`/adapter/input 分别精准失效；测试确认未遍历或读取两个 ignored overlay。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 增加隔离构建缓存与内嵌服务打包"
  ```

### Task 5: 品牌资源校验与 Windows 派生资源

**Files:**

- Create: `xcode/build/bluedcode/common/assets.ts`
- Test: `xcode/build/bluedcode/test/assets.test.ts`

**Interfaces:**

- Consumes: 子仓快照中的 SVG/PNG/wordmark 和 Task 4 `BuildPaths`。
- Produces: `validateBrandAssets(root): Promise<AssetDigest>`、`deriveDesktopAssets(paths): Promise<DerivedAssets>`；`DerivedAssets` 给出 `.ico`、favicon SVG/PNG、wordmark 的 stage 路径。

- [ ] **Step 1: 写恶意 SVG、PNG 和 TUI 排除失败测试**

  ```ts
  test("拒绝外部资源并从视觉摘要排除 tui.json", async () => {
    await expect(validateSvg('<svg><image href="https://example.com/x"/></svg>')).rejects.toThrow("外部资源")
    expect(await visualDigest(root)).toBe(await visualDigest(rootWithDifferentTui))
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/assets.test.ts`

  Expected: FAIL，缺少资源校验器。

- [ ] **Step 3: 实现 SVG/PNG 校验和确定性派生**

  SVG 拒绝 script、事件属性、外链、DOCTYPE、ENTITY、`foreignObject`、嵌入对象；icon 必须正方形、正 viewBox 且 title 为 `BluedCode application icon`；PNG 校验签名和等宽高。使用已安装工具链生成多尺寸 Windows `.ico` 与 renderer favicon，输出只写 stage；同字节输入在不同绝对路径生成相同 digest。

- [ ] **Step 4: 运行 GREEN**

  Run: `bun test ./xcode/build/bluedcode/test/assets.test.ts`

  Expected: PASS；验证 `.ico` 含 Windows 所需尺寸，所有派生文件位于 `.xcode/bluedcode/`，`packages/desktop/resources`、`packages/app/public` 和 `packages/ui` 未改变。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode/common/assets.ts xcode/build/bluedcode/test/assets.test.ts
  git commit -m "feat(build): 生成并校验 BluedCode Desktop 视觉资源"
  ```

### Task 6: 外部 Electron Vite 配置与品牌构建图

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/electron-vite.ts`
- Create: `xcode/build/bluedcode/common/plugins.ts`
- Test: `xcode/build/bluedcode/test/plugins.test.ts`
- Test: `xcode/build/bluedcode/test/electron-vite.test.ts`

**Interfaces:**

- Consumes: Task 2 engine、Task 3 adapter、Task 4 server/cache、Task 5 derived assets。
- Produces: `createBrandPlugins(context): Plugin[]`、`createElectronViteConfig(context): UserConfig`，供 build orchestration 调用。

- [ ] **Step 1: 写真实模块 transform 和配置失败测试**

  ```ts
  test("配置仅使用隔离 server/output 且无 Sentry", async () => {
    const config = await createElectronViteConfig(context)
    expect(JSON.stringify(config)).toContain(context.paths.serverDir)
    expect(JSON.stringify(config)).not.toContain("sentryVitePlugin")
    expect(context.paths.outDir.startsWith(context.paths.workspaceRoot)).toBe(true)
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/plugins.test.ts ./xcode/build/bluedcode/test/electron-vite.test.ts`

  Expected: FAIL，配置工厂不存在。

- [ ] **Step 3: 实现外部配置和 pre transform 插件**

  配置复刻 1.18.18 上游 main/preload/renderer 的入口、CommonJS banner、node-pty narrowing 与 App Vite plugin，`virtual:opencode-server` 指向 Task 4 隔离 bundle。品牌插件 `enforce: "pre"`，只转换 Task 3 声明路径；public assets 通过虚拟/alias/stage 映射替换，不复制上游 icon，不运行上游 `prebuild`/`prepare`。所有 Sentry 环境值在 child process 中清空。

- [ ] **Step 4: 运行 GREEN 与一次真实 compile smoke**

  Run: `bun test ./xcode/build/bluedcode/test/plugins.test.ts ./xcode/build/bluedcode/test/electron-vite.test.ts`

  Run: `bun test ./xcode/build/bluedcode/test/electron-vite.test.ts --test-name-pattern "真实 compile smoke"`

  Expected: tests PASS；main/preload/renderer 输出均在 `.xcode/bluedcode/stage/`，ledger 命中数精确，跟踪树 digest 不变。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 接入隔离 Electron Vite 品牌构建图"
  ```

### Task 7: Portable 打包、发行账本与产物审计

**Files:**

- Create: `xcode/build/bluedcode/version/1.18.18/electron-builder.ts`
- Create: `xcode/build/bluedcode/common/release.ts`
- Create: `xcode/build/bluedcode/common/manifest.ts`
- Create: `xcode/build/bluedcode/build.ts`
- Test: `xcode/build/bluedcode/test/electron-builder.test.ts`
- Test: `xcode/build/bluedcode/test/release.test.ts`
- Test: `xcode/build/bluedcode/test/build.test.ts`

**Interfaces:**

- Consumes: Tasks 1–6 所有公共接口。
- Produces: 命令 `bun xcode/build/bluedcode/build.ts --channel dev|prod [--release YYMMDD-NN]`；`createBuilderConfig(context): Configuration`；`validateReleaseSequence(tags, release)`；`release-manifest.json`。

- [ ] **Step 1: 写 builder 精确合同和发行序列失败测试**

  ```ts
  test("builder 只声明 Windows x64 portable", () => {
    const config = createBuilderConfig(prodContext)
    expect(config.win?.target).toEqual([{ target: "portable", arch: ["x64"] }])
    expect(config.publish).toBeNull()
    expect(JSON.stringify(config)).not.toMatch(/nsis|msi|AppImage|dmg|signWindows/)
  })

  test("同日序号跨小版本递增", () => {
    expect(() => validateReleaseSequence(["bluedcode-v1.18.17-260815-01"], "260815-01")).toThrow("应为 02")
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/electron-builder.test.ts ./xcode/build/bluedcode/test/release.test.ts ./xcode/build/bluedcode/test/build.test.ts`

  Expected: FAIL，缺少打包入口和配置。

- [ ] **Step 3: 实现编排、严格 builder 和 manifest**

  `build.ts` 顺序固定为：参数/Git/快照预检 → server → assets → Electron Vite → output audit → Electron Builder portable → ASAR/PE/文件名审计 → manifest。正式构建先 `git fetch --tags` 并按所有 `bluedcode-v*-YYMMDD-NN` 检查序号，但只生成 tag 候选，不自动创建/推送 tag 或 release。

  manifest 至少记录 product/channel/platform/arch、baseline、完整版本与 commit、目标 tag、framework/adapter/assets digest、EXE 名称/大小/SHA-256、UTC 构建时间、工具版本、缓存命中、转换 ledger 与审计结果；tag 中文注释命令作为 manifest 字段输出。

- [ ] **Step 4: 运行 GREEN 与全量单元测试**

  Run: `bun test ./xcode/build/bluedcode/test ./xcode/build/bluedcode/version/1.18.18/tests`

  Expected: PASS，输出无 warning；测试验证 prod dirty 拒绝、dev/prod 文件名、beta/其他架构拒绝、publish/Sentry/signing 零配置、ASAR 无用户入口。

- [ ] **Step 5: 提交子仓**

  ```bash
  git add xcode/build/bluedcode
  git commit -m "feat(build): 完成 BluedCode Portable 打包与发行审计"
  ```

### Task 8: 根仓公共快照同步与端到端验收

**Files:**

- Create: `../xcode/build/bluedcode/common/types.ts`
- Create: `../xcode/build/bluedcode/common/config.ts`
- Create: `../xcode/build/bluedcode/common/git.ts`
- Create: `../xcode/build/bluedcode/common/snapshot.ts`
- Create: `../xcode/build/bluedcode/common/transform/types.ts`
- Create: `../xcode/build/bluedcode/common/transform/typescript.ts`
- Create: `../xcode/build/bluedcode/common/transform/html.ts`
- Create: `../xcode/build/bluedcode/common/transform/text.ts`
- Create: `../xcode/build/bluedcode/common/transform/engine.ts`
- Create: `../xcode/build/bluedcode/common/audit.ts`
- Create: `../xcode/build/bluedcode/common/cache.ts`
- Create: `../xcode/build/bluedcode/common/paths.ts`
- Create: `../xcode/build/bluedcode/common/server.ts`
- Create: `../xcode/build/bluedcode/common/assets.ts`
- Create: `../xcode/build/bluedcode/common/plugins.ts`
- Create: `../xcode/build/bluedcode/common/release.ts`
- Create: `../xcode/build/bluedcode/common/manifest.ts`
- Modify: `../xcode/build/bluedcode/snapshot-manifest.json`
- Modify: `docs/superpowers/specs/2026-08-15-01-product-branding-design.md`
- Modify after acceptance: `../docs/origin-specs/01-product-branding.md`
- Test: `xcode/build/bluedcode/test/snapshot.test.ts`

**Interfaces:**

- Consumes: 通过前七项验收的子仓公共实现和 prod build command。
- Produces: 根仓可分发公共快照；子仓独立副本；origin spec 版本实现矩阵中的完整实现 commit。

- [ ] **Step 1: 写根仓/子仓逐文件一致性失败测试**

  ```ts
  test("公共文件与根仓规范快照逐字节一致", async () => {
    const differences = await comparePublicSnapshot(childRoot, parentRoot)
    expect(differences).toEqual([])
  })
  ```

- [ ] **Step 2: 运行 RED**

  Run: `bun test ./xcode/build/bluedcode/test/snapshot.test.ts`

  Expected: FAIL，根仓还没有 `common/` 或 manifest 未包含公共内核。

- [ ] **Step 3: 同步公共文件并分别提交**

  只把无 `1.18.18` 路径、规则和条件的公共实现复制到根仓 `xcode/build/bluedcode/common/`；随后从根仓规范副本逐文件复制回子仓对应公共文件并刷新双方 SHA-256。不得复制 `build.ts`、`version/`、Electron 1.18.18 配置或测试报告。

  ```bash
  git -C .. add xcode/build/bluedcode
  git -C .. commit -m "feat(build): 发布 BluedCode 跨版本构建内核"
  git add xcode/build/bluedcode docs/superpowers/specs/2026-08-15-01-product-branding-design.md
  git commit -m "chore(build): 同步 BluedCode 构建内核快照"
  ```

- [ ] **Step 4: 执行 dev 两次构建和 prod 候选构建**

  Run: `bun xcode/build/bluedcode/build.ts --channel dev`

  Run: `bun xcode/build/bluedcode/build.ts --channel dev`

  Expected: 两次均成功且第二次至少报告 server cache hit 与工具缓存命中；transform/main/preload/renderer/assets/package input 分阶段缓存作为后续优化，不阻塞本轮产物；仍重新执行输入校验、产物扫描和 manifest。

  Run: `bun xcode/build/bluedcode/build.ts --channel prod --release 260815-01`

  Expected: 若远端账本表明 `260815-01` 可用，则生成精确命名的 unsigned x64 Portable EXE 与 `release-manifest.json`；若序号已占用，则明确失败并报告期望序号，不能自动改号。

- [ ] **Step 5: 执行 Windows 运行验收**

  在临时目录 A 启动 dev/prod 产物，验证名称、图标、窗口标题、AppData 隔离、无 CLI/WSL/updater/Web/TUI 入口、无 OpenCode 数据迁移且内部 server 正常。将 EXE 移到临时目录 B 再启动，用注册表查询确认 `bluedcode://` 或 `bluedcode-dev://` command 指向 B 的绝对路径；结束测试进程并删除临时测试数据。

- [ ] **Step 6: 完成文档与矩阵记录**

  子仓版本 spec 将状态改为“已实现”，记录测试命令、产物摘要、已知 SmartScreen 限制和 Task 7 的实现 commit。提交该验收文档后取得新的完整子仓 commit；只有上述验收全部通过，才在根仓 origin spec 的版本实现矩阵新增 `v1.18.18` / `dev-foreachcode-1.18.18` / 这个完整子仓 commit / `opencode/docs/superpowers/specs/2026-08-15-01-product-branding-design.md`。

- [ ] **Step 7: 最终提交（先子仓，后根仓 gitlink 与矩阵）**

  ```bash
  git add docs/superpowers/specs/2026-08-15-01-product-branding-design.md
  git commit -m "docs: 记录 BluedCode 1.18.18 构建验收结果"
  git -C .. add docs/origin-specs/01-product-branding.md opencode
  git -C .. commit -m "docs: 登记 BluedCode 1.18.18 版本实现"
  ```

  不创建、不推送 tag，不发布 release，不推送 Git 分支；这些外部副作用等待用户单独授权。
