import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { scanOutput } from "../common/audit"
import { deriveDesktopAssets, type DerivedAssets } from "../common/assets"
import { ensureSafeDirectory, prepareIsolation, removeSafeDirectory } from "../common/isolation"
import { createBuildPaths } from "../common/paths"
import { buildServer } from "../common/server"
import type { BuildIdentity } from "../common/types"
import { adapter11818, version11818Adapter } from "../version/1.18.18"
import { baseline } from "../version/1.18.18/baseline"
import {
  createElectronViteChildEnv,
  createElectronViteConfig,
  requiredBuildTargets,
  stageRendererPublic,
  writeElectronViteContext,
  type ElectronViteContext,
} from "../version/1.18.18/electron-vite"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const temporaryRoots: string[] = []
let fixtureContext: Promise<ElectronViteContext> | undefined

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("createElectronViteConfig", () => {
  test("企业输出审计拒绝主进程可达 OTEL exporter", async () => {
    const root = await temporaryRoot("bluedcode-otel-output-")
    await mkdir(path.join(root, "main"), { recursive: true })
    await writeFile(path.join(root, "main", "index.js"), "process.env.OTEL_EXPORTER_OTLP_ENDPOINT")

    await expectFailure(scanOutput(root, adapter11818.auditPolicy), /审计失败/)
  })

  test("renderer deep link 产品协议由源码实现，构建适配器不再重写", async () => {
    const file = "packages/app/src/pages/layout/deep-links.ts"
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    const transformed = adapter11818.transform(file, source, await identityFixture())

    expect(requiredBuildTargets.renderer).not.toContain(file)
    expect(transformed.code).toContain('startsWith("bluedcode-dev://")')
    expect(transformed.code).toContain('startsWith("bluedcode://")')
    expect(transformed.code).not.toContain('startsWith("opencode://")')
    expect(transformed).toEqual({ code: source, records: [] })
  })

  test("企业 Provider、分享和公共入口不再进入构建期转换目标", () => {
    expect(requiredBuildTargets.renderer).not.toEqual(
      expect.arrayContaining([
        "packages/app/src/hooks/use-providers.ts",
        "packages/app/src/pages/session/timeline/message-timeline.tsx",
        "packages/app/src/app.tsx",
      ]),
    )
  })

  test("构建驱动的 Electron Vite 上下文拒绝丢失 selected adapter", async () => {
    const context = await contextFixture()
    await expectFailure(createElectronViteConfig({ ...context, adapter: undefined } as ElectronViteContext), /adapter/)
  })

  test("配置复刻三入口并只使用隔离 server、stage 和绝对路径", async () => {
    const context = await contextFixture()
    const config = await createElectronViteConfig(context)
    const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
    const rendererRoot = path.join(desktopRoot, "src", "renderer")

    expect(config.main?.root).toBe(desktopRoot)
    expect(config.preload?.root).toBe(desktopRoot)
    expect(config.renderer?.root).toBe(rendererRoot)
    expect(config.main?.build?.rollupOptions?.input).toEqual({
      index: path.join(desktopRoot, "src", "main", "index.ts"),
      sidecar: path.join(desktopRoot, "src", "main", "sidecar.ts"),
    })
    expect(config.preload?.build?.rollupOptions?.input).toEqual({
      index: path.join(desktopRoot, "src", "preload", "index.ts"),
    })
    expect(config.renderer?.build?.rollupOptions?.input).toEqual({
      main: path.join(rendererRoot, "index.html"),
    })
    for (const [target, item] of Object.entries({
      main: config.main,
      preload: config.preload,
      renderer: config.renderer,
    })) {
      expect(item?.envPrefix).toBe("BLUEDCODE_VITE_")
      const outDir = item?.build?.outDir
      expect(typeof outDir).toBe("string")
      expect(path.resolve(String(outDir)).startsWith(path.join(context.paths.stageDir, "desktop", "out"))).toBe(true)
      expect(path.basename(String(outDir))).toBe(target)
    }

    const banner = config.main?.build?.rollupOptions?.output
    expect(JSON.stringify(banner)).toContain("__cjs_mod__.createRequire(import.meta.url)")
    expect(config.main?.build?.rollupOptions?.external ?? []).not.toContain("jsonc-parser")
    expect(config.main?.resolve?.alias).toMatchObject({
      "jsonc-parser": expect.stringContaining(path.join("packages", "opencode", "node_modules", "jsonc-parser")),
    })
    expect(config.main?.build?.externalizeDeps).toEqual({
      include: [`@lydell/node-pty-${process.platform}-${process.arch}`],
      exclude: [
        "@zip.js/zip.js",
        "drizzle-orm",
        "effect",
        "electron-context-menu",
        "electron-log",
        "electron-store",
        "electron-window-state",
      ],
    })
    expect(pluginNames(config.main?.plugins)).toContain("opencode:node-pty-narrower")
    expect(pluginNames(config.main?.plugins)).toContain("bluedcode:virtual-server-module")
    expect(pluginNames(config.renderer?.plugins)).toContain("bluedcode:transform")
    expect(pluginNames(config.renderer?.plugins)).toContain("bluedcode:output-audit")
    expect(config.main?.resolve?.alias).toMatchObject({ "virtual:opencode-server": context.server.file })
    expect(JSON.stringify(config)).not.toMatch(/sentryVitePlugin|publish|prepare|prebuild|copy-icons/i)
    expect(pluginNames(config.renderer?.plugins).join("\n")).not.toMatch(/sentry/i)
  })

  test("新建会话页 v2 字标也必须使用 BluedCode wordmark 资源", async () => {
    const config = await createElectronViteConfig(await contextFixture())
    const plugin = requireStaticBrandPlugin(config.renderer?.plugins)

    const id = await plugin.resolveId.call({}, "@opencode-ai/ui/v2/wordmark-v2")
    expect(typeof id).toBe("string")
    const loaded = await plugin.load.call({}, id)
    expect(String(loaded)).toContain("export const WordmarkV2")
    expect(String(loaded)).toContain("./wordmark.svg")
    expect(String(loaded)).toContain("logo-wordmark-v2")
    expect(String(loaded)).not.toContain('viewBox="0 0 720 129"')
  })

  test("构建前封闭整个 Electron out 根并移除旧的二进制与 legacy sibling", async () => {
    const context = await contextFixture()
    const outputRoot = path.join(context.paths.stageDir, "desktop", "out")
    const extra = path.join(outputRoot, "extra.dll")
    const legacy = path.join(outputRoot, "legacy", "old.js")
    await mkdir(path.dirname(legacy), { recursive: true })
    await Promise.all([
      writeFile(extra, new Uint8Array([0, 1, 2, 3])),
      writeFile(legacy, new Uint8Array([0, 108, 101, 103, 97, 99, 121])),
    ])

    await createElectronViteConfig(context)

    expect(await exists(extra)).toBe(false)
    expect(await exists(legacy)).toBe(false)
    expect((await readdir(outputRoot)).sort()).toEqual(["main", "preload", "renderer"])
  })

  test("预置 Electron out junction 时拒绝构建且外部 sentinel 不变", async () => {
    if (process.platform !== "win32") return
    const context = await contextFixture()
    const outputRoot = path.join(context.paths.stageDir, "desktop", "out")
    const external = await temporaryRoot("bluedcode-electron-out-external-")
    const sentinel = path.join(external, "sentinel.txt")
    const isolation = await prepareIsolation(context.paths)
    await writeFile(sentinel, "do-not-touch")
    await removeSafeDirectory(isolation, outputRoot)
    await symlink(external, outputRoot, "junction")

    const failure = await createElectronViteConfig(context).then(
      () => undefined,
      (error: unknown) => error,
    )
    const sentinelContent = await readFile(sentinel, "utf8")
    const externalFiles = await relativeFiles(external)
    const stats = await lstat(outputRoot)
    if (stats.isSymbolicLink()) {
      await rm(outputRoot, { recursive: true })
      await ensureSafeDirectory(isolation, outputRoot)
    }

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/链接|junction/i)
    expect(stats.isSymbolicLink()).toBe(true)
    expect(sentinelContent).toBe("do-not-touch")
    expect(externalFiles).toEqual(["sentinel.txt"])
  })

  test("public stage 只保留真实运行资源并用 Task 5 派生品牌资源覆盖", async () => {
    const context = await contextFixture()
    const config = await createElectronViteConfig(context)
    const publicDir = config.renderer?.publicDir
    if (typeof publicDir !== "string") throw new Error("renderer publicDir 缺失")
    expect(publicDir.startsWith(path.join(context.paths.stageDir, "public"))).toBe(true)
    expect(await relativeFiles(publicDir)).toEqual([
      "assets/Inter.ttf",
      "assets/JetBrainsMonoNerdFontMono-Regular.woff2",
      "favicon.ico",
      "favicon.png",
      "favicon.svg",
      "oc-theme-preload.js",
      "social-share.png",
      "wordmark.svg",
    ])
    for (const file of ["assets/Inter.ttf", "assets/JetBrainsMonoNerdFontMono-Regular.woff2", "oc-theme-preload.js"]) {
      expect(await digestFile(path.join(publicDir, ...file.split("/")))).toBe(
        await digestFile(path.join(repositoryRoot, "packages", "app", "public", ...file.split("/"))),
      )
    }
    expect(await digestFile(path.join(publicDir, "favicon.png"))).toBe(await digestFile(context.assets.faviconPng))
    expect(await digestFile(path.join(publicDir, "favicon.svg"))).toBe(await digestFile(context.assets.faviconSvg))
    expect(await digestFile(path.join(publicDir, "favicon.ico"))).toBe(await digestFile(context.assets.iconIco))
    expect(await digestFile(path.join(publicDir, "wordmark.svg"))).toBe(await digestFile(context.assets.wordmarkSvg))
    expect(await digestFile(path.join(publicDir, "social-share.png"))).toBe(await digestFile(context.assets.faviconPng))
    for (const forbidden of [
      "apple-touch-icon.png",
      "favicon-96x96-v3.png",
      "favicon-v3.svg",
      "site.webmanifest",
      "social-share-zen.png",
      "tui.json",
      "web-app-manifest-512x512.png",
    ]) {
      expect(await exists(path.join(publicDir, forbidden))).toBe(false)
    }
  })

  test("public stage 拒绝上游 junction 且不接触外部文件", async () => {
    if (process.platform !== "win32") return
    const root = await temporaryRoot("bluedcode-public-link-")
    const external = await temporaryRoot("bluedcode-public-external-")
    const paths = createBuildPaths(await identityFixture(), root)
    const publicSource = path.join(root, "packages", "app", "public")
    const externalAssets = path.join(external, "assets")
    await Promise.all([mkdir(publicSource, { recursive: true }), mkdir(externalAssets, { recursive: true })])
    await writeFile(path.join(externalAssets, "sentinel.txt"), "do-not-touch")
    await symlink(externalAssets, path.join(publicSource, "assets"), "junction")

    await expectFailure(stageRendererPublic(paths, derivedAssetFixture(paths.stageDir)), /链接|junction/i)
    expect(await readFile(path.join(externalAssets, "sentinel.txt"), "utf8")).toBe("do-not-touch")
    expect(await relativeFiles(externalAssets)).toEqual(["sentinel.txt"])
  })

  test("child env 使用白名单并显式清空 Sentry、publish 与 signing 值", async () => {
    const context = await contextFixture()
    const env = createElectronViteChildEnv(
      "D:\\isolated\\context.json",
      {
        PATH: "trusted-path",
        SYSTEMROOT: "C:\\Windows",
        SENTRY_AUTH_TOKEN: "must-not-pass",
        SENTRY_DSN: "must-not-pass",
        VITE_SENTRY_RELEASE: "must-not-pass",
        GH_TOKEN: "must-not-pass",
        CSC_LINK: "must-not-pass",
        UNRELATED_SECRET: "must-not-pass",
      },
      context.identity.channel,
    )
    expect(env.PATH).toBe("trusted-path")
    expect(env.SYSTEMROOT).toBe("C:\\Windows")
    expect(env.BLUEDCODE_ELECTRON_VITE_CONTEXT).toBe("D:\\isolated\\context.json")
    expect(env.OPENCODE_CHANNEL).toBe("dev")
    expect(env.UNRELATED_SECRET).toBeUndefined()
    for (const key of [
      "SENTRY_AUTH_TOKEN",
      "SENTRY_DSN",
      "SENTRY_ORG",
      "SENTRY_PROJECT",
      "SENTRY_RELEASE",
      "VITE_SENTRY_DSN",
      "VITE_SENTRY_RELEASE",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "WIN_CSC_LINK",
      "WIN_CSC_KEY_PASSWORD",
    ]) {
      expect(env[key]).toBe("")
    }
  })

  test("配置拒绝 server bundle 越出 Task 4 隔离目录", async () => {
    const context = await contextFixture()
    await expectFailure(
      createElectronViteConfig({
        ...context,
        server: { ...context.server, file: path.join(repositoryRoot, "packages", "opencode", "src", "node.ts") },
      }),
      /server|隔离|后代|越界/i,
    )
  })

  test("配置拒绝没有认证 WASM 的 server bundle", async () => {
    const context = await freshServerContextFixture()
    await expectFailure(
      createElectronViteConfig({ ...context, server: { ...context.server, assets: [] } }),
      /WASM|assets/i,
    )
  })

  test("配置拒绝 server bundle 目录中的额外 WASM", async () => {
    const context = await freshServerContextFixture()
    await writeFile(path.join(path.dirname(context.server.file), "extra.wasm"), new Uint8Array([0, 1, 2, 3]))
    await expectFailure(createElectronViteConfig(context), /WASM|集合|extra/i)
  })

  test("配置拒绝缺失的认证 WASM", async () => {
    const context = await freshServerContextFixture()
    const asset = context.server.assets[0]
    if (!asset) throw new Error("测试 server 缺少 WASM")
    await rm(path.join(path.dirname(context.server.file), ...asset.file.split("/")))
    await expectFailure(createElectronViteConfig(context), /WASM|缺失|集合/i)
  })

  test("配置拒绝摘要被篡改的认证 WASM", async () => {
    const context = await freshServerContextFixture()
    const asset = context.server.assets[0]
    if (!asset) throw new Error("测试 server 缺少 WASM")
    await writeFile(
      path.join(path.dirname(context.server.file), ...asset.file.split("/")),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 1]),
    )
    await expectFailure(createElectronViteConfig(context), /WASM|摘要|digest/i)
  })
})

test("真实 compile smoke 生成三类输出、精确 ledger 且 tracked tree digest 不变", async () => {
  const identity = await identityFixture()
  const paths = createBuildPaths(identity, repositoryRoot)
  const models = path.join(paths.workspaceRoot, "fixtures", "models.json")
  await mkdir(path.dirname(models), { recursive: true })
  await writeFile(models, "{}\n")
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = models
  const server = await buildServer(paths, identity, baseline, version11818Adapter).finally(() => {
    if (previousModels === undefined) delete process.env.MODELS_DEV_API_JSON
    else process.env.MODELS_DEV_API_JSON = previousModels
  })
  const assets = await deriveDesktopAssets(paths)
  const context: ElectronViteContext = { adapter: version11818Adapter, assets, identity, paths, server }
  const contextFile = await writeElectronViteContext(context)
  const outputRoot = path.join(paths.stageDir, "desktop", "out")
  const staleBinary = path.join(outputRoot, "extra.dll")
  const staleLegacy = path.join(outputRoot, "legacy", "old.js")
  await mkdir(path.dirname(staleLegacy), { recursive: true })
  await Promise.all([
    writeFile(staleBinary, new Uint8Array([0, 1, 2, 3])),
    writeFile(staleLegacy, new Uint8Array([0, 108, 101, 103, 97, 99, 121])),
  ])
  const before = await trackedTreeDigest(repositoryRoot)
  const cli = path.join(
    repositoryRoot,
    "packages",
    "desktop",
    "node_modules",
    "electron-vite",
    "bin",
    "electron-vite.js",
  )
  const configFile = path.join(repositoryRoot, "xcode", "build", "bluedcode", "version", "1.18.18", "electron-vite.ts")
  const child = Bun.spawn([process.execPath, cli, "build", "--config", configFile, "--logLevel", "warn"], {
    cwd: path.join(repositoryRoot, "packages", "desktop"),
    env: createElectronViteChildEnv(contextFile, process.env, identity.channel),
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`真实 electron-vite compile 失败 (${exitCode})\n${stdout}\n${stderr}`)
  const after = await trackedTreeDigest(repositoryRoot)
  const trackedDigestFile = path.join(paths.stageDir, "electron-vite", "tracked-tree-digest.json")
  await writeFile(trackedDigestFile, `${JSON.stringify({ version: 1, before, after }, null, 2)}\n`)
  expect(after).toBe(before)
  expect(JSON.parse(await readFile(trackedDigestFile, "utf8"))).toEqual({ version: 1, before, after })

  expect((await readdir(outputRoot)).sort()).toEqual(["main", "preload", "renderer"])
  expect(await exists(staleBinary)).toBe(false)
  expect(await exists(staleLegacy)).toBe(false)
  expect(await exists(path.join(outputRoot, "main", "index.js"))).toBe(true)
  expect(await exists(path.join(outputRoot, "main", "sidecar.js"))).toBe(true)
  expect(await exists(path.join(outputRoot, "preload", "index.js"))).toBe(true)
  expect(await exists(path.join(outputRoot, "renderer", "index.html"))).toBe(true)
  const outputFiles = await relativeFiles(outputRoot)
  expect(outputFiles.some((file) => file.startsWith("renderer/assets/"))).toBe(true)
  expect(outputFiles.some((file) => file.endsWith("tui.json"))).toBe(false)

  const ledgers = await Promise.all(
    (await relativeFiles(path.join(paths.stageDir, "ledger"))).map(
      async (file) =>
        JSON.parse(await readFile(path.join(paths.stageDir, "ledger", file), "utf8")) as {
          events: Array<{ stage: string; productProfileSha256: string; file: string }>
        },
    ),
  )
  const events = ledgers.flatMap((ledger) => ledger.events)
  expect(events.map((event) => event.stage)).toEqual(expect.arrayContaining(["server", "main", "preload", "renderer"]))
  expect(new Set(events.map((event) => event.productProfileSha256)).size).toBe(1)
  expect(events.some((event) => event.file === "packages/app/src/pages/session/timeline/message-timeline.tsx")).toBe(
    false,
  )

  const artifacts = await Promise.all(
    outputFiles.map(async (file) => {
      const content = await readFile(path.join(outputRoot, ...file.split("/")))
      return {
        file,
        size: content.byteLength,
        digest: createHash("sha256").update(content).digest("hex"),
      }
    }),
  )
  const audits = await Promise.all(
    (await relativeFiles(path.join(paths.stageDir, "electron-vite", "audits"))).map(async (file) =>
      requireOutputAudit(
        JSON.parse(await readFile(path.join(paths.stageDir, "electron-vite", "audits", file), "utf8")),
      ),
    ),
  )
  const outputAudit = audits.find((item) => JSON.stringify(item.artifacts) === JSON.stringify(artifacts))
  if (!outputAudit) throw new Error("真实 compile 缺少当前输出的递归产物 audit")
  expect(outputAudit.topLevel).toEqual(["main", "preload", "renderer"])
  expect(outputAudit.artifacts).toEqual(artifacts)

  expect(server.assets.length).toBeGreaterThan(0)
  const mainChunks = path.join(outputRoot, "main", "chunks")
  const wasmFiles = (await relativeFiles(mainChunks)).filter((file) => file.endsWith(".wasm"))
  expect(wasmFiles).toEqual(server.assets.map((asset) => path.posix.basename(asset.file)).sort())
  for (const asset of server.assets) {
    const file = path.join(mainChunks, path.posix.basename(asset.file))
    expect(await digestFile(file)).toBe(asset.digest)
    expect((await lstat(file)).size).toBe(asset.size)
  }

  const disabledSurfaceAudit = await scanOutput(outputRoot, adapter11818.auditPolicy)
  expect(disabledSurfaceAudit).toMatchObject({ passed: true })
  expect(disabledSurfaceAudit.allowed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ allowanceId: "main-disabled-wsl-ipc-channels" }),
      expect.objectContaining({ allowanceId: "preload-disabled-cli-api" }),
      expect.objectContaining({ allowanceId: "renderer-disabled-wsl-api" }),
      expect.objectContaining({ allowanceId: "server-enterprise-share-command-schema" }),
      expect.objectContaining({ allowanceId: "server-enterprise-unshare-http-contract" }),
      expect.objectContaining({ allowanceId: "server-enterprise-share-create-symbol" }),
      expect.objectContaining({ allowanceId: "server-enterprise-share-remove-symbol" }),
      expect.objectContaining({ allowanceId: "server-enterprise-public-ui-upstream" }),
      expect.objectContaining({ allowanceId: "server-enterprise-model-catalog-upstream" }),
      expect.objectContaining({ allowanceId: "server-enterprise-model-catalog-fetch-symbol" }),
    ]),
  )
  const outputText = await textOutput(outputRoot)
  expect(outputText).toContain("PRODUCT_CAPABILITY_DISABLED: 遥测网络已由产品策略禁用")
  expect(outputText).not.toContain('startsWith("OTEL_")')
  expect(outputText).not.toMatch(/@sentry|sentry\.io|SENTRY_|electron-updater|startBackgroundCli/)
  const rendererText = await textOutput(path.join(outputRoot, "renderer"))
  expect(rendererText).not.toContain("0 0 234 42")
  expect(rendererText).toContain("wordmark.svg")
  expect(rendererText).toContain("api.getDesktopInitialization?.()")
  expect(outputText).toContain("version: deps.visibleVersion")
  expect(rendererText).toContain("./favicon.png")
  expect(rendererText).not.toContain("https://opencode.ai/favicon")
  expect(outputText).toContain("get-desktop-initialization")
  expect(outputText).not.toContain("sentryVitePlugin")
}, 300_000)

async function contextFixture() {
  fixtureContext ??= (async () => {
    const identity = await identityFixture()
    const paths = createBuildPaths(identity, repositoryRoot)
    return {
      adapter: version11818Adapter,
      assets: await deriveDesktopAssets(paths),
      identity,
      paths,
      server: await writeServerFixture(path.join(paths.serverDir, "electron-vite-test")),
    }
  })()
  return fixtureContext
}

async function freshServerContextFixture() {
  const context = await contextFixture()
  return {
    ...context,
    server: await writeServerFixture(path.join(context.paths.serverDir, `electron-vite-test-${crypto.randomUUID()}`)),
  }
}

async function writeServerFixture(directory: string) {
  const code = Buffer.from("export const Server = {}\n")
  const sourceMap = Buffer.from('{"version":3}\n')
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(path.join(directory, "node.js"), code),
    writeFile(path.join(directory, "node.js.map"), sourceMap),
    writeFile(path.join(directory, "fixture.wasm"), wasm),
  ])
  return {
    file: path.join(directory, "node.js"),
    digest: createHash("sha256").update(code).digest("hex"),
    size: code.byteLength,
    assets: [
      {
        file: "fixture.wasm",
        digest: createHash("sha256").update(wasm).digest("hex"),
        size: wasm.byteLength,
      },
    ],
  }
}

async function identityFixture(): Promise<BuildIdentity> {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repositoryRoot })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  const commit = result.stdout.toString().trim()
  const shortCommit = commit.slice(0, 10)
  const version = `1.18.18-dev-${shortCommit}`
  return {
    channel: "dev",
    name: "BluedCode Dev",
    appId: "ai.bluedcode.desktop.dev",
    protocol: "bluedcode-dev",
    version,
    commit,
    shortCommit,
    artifactName: `BluedCode-Dev-${version}-windows-x64-portable.exe`,
  }
}

function derivedAssetFixture(stageDir: string): DerivedAssets {
  const root = path.join(stageDir, "assets", "fixture")
  return {
    iconIco: path.join(root, "icon.ico"),
    faviconSvg: path.join(root, "favicon.svg"),
    faviconPng: path.join(root, "favicon.png"),
    wordmarkSvg: path.join(root, "wordmark.svg"),
  }
}

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function pluginNames(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(pluginNames)
  if (typeof value === "object" && "name" in value && typeof value.name === "string") return [value.name]
  return []
}

function requireStaticBrandPlugin(value: unknown) {
  const plugins = Array.isArray(value) ? value.flat(Number.POSITIVE_INFINITY) : [value]
  const plugin = plugins.find(
    (item): item is { name: string; resolveId: Function; load: Function } =>
      !!item &&
      typeof item === "object" &&
      "name" in item &&
      item.name === "bluedcode:static-brand-assets" &&
      "resolveId" in item &&
      typeof item.resolveId === "function" &&
      "load" in item &&
      typeof item.load === "function",
  )
  if (!plugin) throw new Error("缺少静态品牌资源 plugin")
  return plugin
}

async function relativeFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort()

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(child, childRelative)
      else if (entry.isFile()) files.push(childRelative)
      else throw new Error(`测试输出包含非普通文件: ${child}`)
    }
  }
}

async function textOutput(root: string) {
  const chunks: string[] = []
  for (const file of await relativeFiles(root)) {
    const bytes = await readFile(path.join(root, ...file.split("/")))
    if (!bytes.includes(0)) chunks.push(bytes.toString("utf8"))
  }
  return chunks.join("\n")
}

async function digestFile(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
}

async function exists(file: string) {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

async function trackedTreeDigest(root: string) {
  const result = Bun.spawnSync(["git", "ls-files"], { cwd: root })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  const files = result.stdout.toString().split(/\r?\n/).filter(Boolean).sort()
  const digest = createHash("sha256")
  for (const file of files)
    digest
      .update(file)
      .update("\0")
      .update(await readFile(path.join(root, file)))
      .update("\0")
  return digest.digest("hex")
}

function requireCompileLedger(value: unknown) {
  if (!isCompileLedger(value)) throw new Error("compile ledger 结构无效")
  return value
}

function isCompileLedger(value: unknown): value is {
  modules: Array<{ target: string; file: string; transforms: number }>
  records: Array<{ file: string; hits: number }>
} {
  if (!value || typeof value !== "object" || !("modules" in value) || !("records" in value)) return false
  if (!Array.isArray(value.modules) || !Array.isArray(value.records)) return false
  return (
    value.modules.every(
      (module) =>
        !!module &&
        typeof module === "object" &&
        typeof module.target === "string" &&
        typeof module.file === "string" &&
        typeof module.transforms === "number",
    ) &&
    value.records.every(
      (record) =>
        !!record && typeof record === "object" && typeof record.file === "string" && typeof record.hits === "number",
    )
  )
}

function requireOutputAudit(value: unknown) {
  if (!isOutputAudit(value)) throw new Error("output audit 结构无效")
  return value
}

function isOutputAudit(value: unknown): value is {
  version: 1
  topLevel: string[]
  artifacts: Array<{ file: string; size: number; digest: string }>
} {
  if (!value || typeof value !== "object") return false
  if (!("version" in value) || value.version !== 1) return false
  if (!("topLevel" in value) || !Array.isArray(value.topLevel)) return false
  if (!("artifacts" in value) || !Array.isArray(value.artifacts)) return false
  return (
    Object.keys(value).sort().join(",") === "artifacts,topLevel,version" &&
    value.topLevel.every((item) => typeof item === "string") &&
    value.artifacts.every(
      (artifact) =>
        !!artifact &&
        typeof artifact === "object" &&
        Object.keys(artifact).sort().join(",") === "digest,file,size" &&
        "file" in artifact &&
        typeof artifact.file === "string" &&
        "size" in artifact &&
        typeof artifact.size === "number" &&
        "digest" in artifact &&
        typeof artifact.digest === "string" &&
        /^[a-f0-9]{64}$/.test(artifact.digest),
    )
  )
}

async function expectFailure(operation: Promise<unknown>, message: string | RegExp) {
  let failure: unknown
  try {
    await operation
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  if (typeof message === "string") expect(String(failure)).toContain(message)
  else expect(String(failure)).toMatch(message)
}
