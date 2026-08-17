import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ensureSafeDirectory, prepareIsolation } from "../common/isolation"
import { createBrandPlugins, createBrandTransformSession, type BrandBuildTarget } from "../common/plugins"
import type { BuildIdentity } from "../common/types"
import { adapter11818 } from "../version/1.18.18"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const temporaryRoots: string[] = []
const identity: BuildIdentity = {
  channel: "dev",
  name: "BluedCode Dev",
  appId: "ai.bluedcode.desktop.dev",
  protocol: "bluedcode-dev",
  version: "1.18.18-dev-0123456789",
  commit: "0123456789abcdef0123456789abcdef01234567",
  shortCommit: "0123456789",
  artifactName: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("createBrandPlugins", () => {
  test("受控 TypeScript 模块在 pre 阶段转换并写入目标级 ledger", async () => {
    const file = "packages/desktop/src/renderer/index.tsx"
    const ledger = await ledgerFixture()
    const session = createBrandTransformSession(["renderer"])
    const plugins = createBrandPlugins({
      adapter: adapter11818,
      identity,
      isolation: ledger.isolation,
      ledgerRoot: ledger.root,
      repositoryRoot,
      requiredBuildTargets: [file],
      session,
      target: "renderer",
    })
    const plugin = requireBrandPlugin(plugins)
    expect(plugin.enforce).toBe("pre")

    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    const transformed = await runTransform(plugin, source, path.join(repositoryRoot, ...file.split("/")))
    expect(requireCode(transformed)).toContain("desktopNotificationIcon")
    await runBuildEnd(plugin)

    const value = requireLedger(JSON.parse(await readFile(await onlyLedgerFile(ledger.root), "utf8")))
    expect(value.events).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "renderer", file })]))
  })

  test("未知模块与带 query 的伪受控模块保持原样且不进入 ledger", async () => {
    const ledger = await ledgerFixture()
    const plugins = createBrandPlugins({
      adapter: adapter11818,
      identity,
      isolation: ledger.isolation,
      ledgerRoot: ledger.root,
      repositoryRoot,
      requiredBuildTargets: [],
      session: createBrandTransformSession(["renderer"]),
      target: "renderer",
    })
    const plugin = requireBrandPlugin(plugins)
    const unknown = "export const product = 'OpenCode'"
    expect(await runTransform(plugin, unknown, path.join(repositoryRoot, "packages/app/src/unknown.ts"))).toBeNull()
    expect(
      await runTransform(
        plugin,
        unknown,
        `${path.join(repositoryRoot, "packages/desktop/src/renderer/index.tsx")}?raw`,
      ),
    ).toBeNull()
    await runBuildEnd(plugin)

    const value = requireLedger(JSON.parse(await readFile(await onlyLedgerFile(ledger.root), "utf8")))
    expect(value.events).toEqual([])
  })

  test("HTML 入口通过 pre transformIndexHtml 使用品牌资源", async () => {
    const file = "packages/desktop/src/renderer/index.html"
    const ledger = await ledgerFixture()
    const plugin = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: ledger.isolation,
        ledgerRoot: ledger.root,
        repositoryRoot,
        requiredBuildTargets: [file],
        session: createBrandTransformSession(["renderer"]),
        target: "renderer",
      }),
    )
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    const transformed = await runTransformIndexHtml(plugin, source, path.join(repositoryRoot, ...file.split("/")))
    expect(transformed).toContain("<title>BluedCode Dev</title>")
    expect(transformed).toContain('href="./favicon.png"')
    expect(transformed).not.toContain("favicon-96x96-v3.png")
    await runBuildEnd(plugin)
  })

  test("buildEnd 拒绝缺失、重复和未声明的受控模块", async () => {
    const file = "packages/desktop/src/renderer/index.tsx"
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    await expectFailure(buildEndFailure("renderer", [file], []), "缺少")
    await expectFailure(buildEndFailure("renderer", [file], [file, file], source), "恰好转换一次")
    const preload = "packages/desktop/src/preload/index.ts"
    await expectFailure(
      buildEndFailure("preload", [], [preload], await readFile(path.join(repositoryRoot, ...preload.split("/")), "utf8")),
      "未声明",
    )
  })

  test("多目标 compile 失败前不发布部分 ledger 或临时文件", async () => {
    const file = "packages/desktop/src/preload/index.ts"
    const ledger = await ledgerFixture()
    const session = createBrandTransformSession(["preload", "renderer"])
    const preload = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: ledger.isolation,
        ledgerRoot: ledger.root,
        repositoryRoot,
        requiredBuildTargets: [file],
        session,
        target: "preload",
      }),
    )
    await runTransform(
      preload,
      await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8"),
      path.join(repositoryRoot, ...file.split("/")),
    )
    await runBuildEnd(preload)
    expect(await readdir(ledger.root)).toEqual([])

    const renderer = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: ledger.isolation,
        ledgerRoot: ledger.root,
        repositoryRoot,
        requiredBuildTargets: ["packages/desktop/src/renderer/index.tsx"],
        session,
        target: "renderer",
      }),
    )
    await expectFailure(runBuildEnd(renderer), "缺少")
    expect(await readdir(ledger.root)).toEqual([])
  })

  test("ledger root 的 ancestor junction 被拒绝且外部 sentinel 不变", async () => {
    if (process.platform !== "win32") return
    const fixture = await isolationFixture()
    const external = await temporaryRoot()
    const sentinel = path.join(external, "sentinel.txt")
    const linkedRoot = path.join(fixture.outputRoot, "ledger-link")
    await writeFile(sentinel, "do-not-touch")
    await symlink(external, linkedRoot, "junction")
    const file = "packages/desktop/src/renderer/index.tsx"
    const plugin = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: fixture.isolation,
        ledgerRoot: linkedRoot,
        repositoryRoot,
        requiredBuildTargets: [file],
        session: createBrandTransformSession(["renderer"]),
        target: "renderer",
      }),
    )
    await runTransform(
      plugin,
      await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8"),
      path.join(repositoryRoot, ...file.split("/")),
    )

    await expectFailure(runBuildEnd(plugin), /链接|junction/i)
    expect(await readFile(sentinel, "utf8")).toBe("do-not-touch")
    expect(await readdir(external)).toEqual(["sentinel.txt"])
  })

  test("已有 ledger file 路径 junction 被拒绝且不会覆盖外部 sentinel", async () => {
    if (process.platform !== "win32") return
    const ledger = await ledgerFixture()
    const file = "packages/desktop/src/renderer/index.tsx"
    const first = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: ledger.isolation,
        ledgerRoot: ledger.root,
        repositoryRoot,
        requiredBuildTargets: [file],
        session: createBrandTransformSession(["renderer"]),
        target: "renderer",
      }),
    )
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    await runTransform(first, source, path.join(repositoryRoot, ...file.split("/")))
    await runBuildEnd(first)
    const ledgerFile = await onlyLedgerFile(ledger.root)
    const external = await temporaryRoot()
    const sentinel = path.join(external, "sentinel.json")
    await unlink(ledgerFile)
    await writeFile(sentinel, "do-not-touch")
    await symlink(external, ledgerFile, "junction")

    const second = requireBrandPlugin(
      createBrandPlugins({
        adapter: adapter11818,
        identity,
        isolation: ledger.isolation,
        ledgerRoot: ledger.root,
        repositoryRoot,
        requiredBuildTargets: [file],
        session: createBrandTransformSession(["renderer"]),
        target: "renderer",
      }),
    )
    await runTransform(second, source, path.join(repositoryRoot, ...file.split("/")))
    await expectFailure(runBuildEnd(second), /链接|junction/i)
    expect(await readFile(sentinel, "utf8")).toBe("do-not-touch")
    expect(await readdir(external)).toEqual(["sentinel.json"])
  })

  test("已有不可变 ledger 内容冲突时拒绝覆盖或删除 target", async () => {
    const ledger = await ledgerFixture()
    const file = "packages/desktop/src/renderer/index.tsx"
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    const compile = async () => {
      const plugin = requireBrandPlugin(
        createBrandPlugins({
          adapter: adapter11818,
          identity,
          isolation: ledger.isolation,
          ledgerRoot: ledger.root,
          repositoryRoot,
          requiredBuildTargets: [file],
          session: createBrandTransformSession(["renderer"]),
          target: "renderer",
        }),
      )
      await runTransform(plugin, source, path.join(repositoryRoot, ...file.split("/")))
      await runBuildEnd(plugin)
    }
    await compile()
    const target = await onlyLedgerFile(ledger.root)
    await writeFile(target, "tampered-ledger")

    await expectFailure(compile(), /摘要|冲突/i)
    expect(await readFile(target, "utf8")).toBe("tampered-ledger")
    expect((await readdir(ledger.root)).filter((item) => item.startsWith(".tmp-"))).toEqual([])
  })

  test("并发发布相同 ledger 只留下一个完整不可变文件", async () => {
    const ledger = await ledgerFixture()
    const file = "packages/desktop/src/renderer/index.tsx"
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")
    const compile = async () => {
      const plugin = requireBrandPlugin(
        createBrandPlugins({
          adapter: adapter11818,
          identity,
          isolation: ledger.isolation,
          ledgerRoot: ledger.root,
          repositoryRoot,
          requiredBuildTargets: [file],
          session: createBrandTransformSession(["renderer"]),
          target: "renderer",
        }),
      )
      await runTransform(plugin, source, path.join(repositoryRoot, ...file.split("/")))
      await runBuildEnd(plugin)
    }

    await Promise.all([compile(), compile()])
    expect((await readdir(ledger.root)).filter((item) => item.startsWith(".tmp-"))).toEqual([])
    expect((await readdir(ledger.root)).filter((item) => item.endsWith(".json"))).toHaveLength(1)
    expect(requireLedger(JSON.parse(await readFile(await onlyLedgerFile(ledger.root), "utf8"))).events).toEqual(
      expect.arrayContaining([expect.objectContaining({ stage: "renderer", file })]),
    )
  })
})

async function buildEndFailure(
  target: BrandBuildTarget,
  requiredBuildTargets: readonly string[],
  files: readonly string[],
  source?: string,
) {
  const ledger = await ledgerFixture()
  const plugin = requireBrandPlugin(
    createBrandPlugins({
      adapter: adapter11818,
      identity,
      isolation: ledger.isolation,
      ledgerRoot: ledger.root,
      repositoryRoot,
      requiredBuildTargets,
      session: createBrandTransformSession([target]),
      target,
    }),
  )
  for (const file of files) {
    await runTransform(
      plugin,
      source ?? (await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8")),
      path.join(repositoryRoot, ...file.split("/")),
    )
  }
  await runBuildEnd(plugin)
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-plugins-"))
  temporaryRoots.push(root)
  return root
}

async function isolationFixture() {
  const temporary = await temporaryRoot()
  const repository = path.join(temporary, "repository")
  const outputRoot = path.join(repository, ".xcode", "bluedcode")
  await mkdir(repository, { recursive: true })
  const isolation = await prepareIsolation({ repositoryRoot: repository, outputRoot })
  return { isolation, outputRoot }
}

async function ledgerFixture() {
  const fixture = await isolationFixture()
  const root = path.join(fixture.outputRoot, "ledger")
  await ensureSafeDirectory(fixture.isolation, root)
  return { ...fixture, root }
}

async function onlyLedgerFile(root: string) {
  const files = (await readdir(root)).filter((file) => file.endsWith(".json"))
  if (files.length !== 1) throw new Error(`ledger 文件数量不是 1: ${files.join(", ")}`)
  return path.join(root, files[0] ?? "")
}

function requireBrandPlugin(plugins: ReturnType<typeof createBrandPlugins>) {
  const plugin = plugins.find((item) => item && typeof item === "object" && item.name === "bluedcode:transform")
  if (!plugin || typeof plugin !== "object") throw new Error("缺少品牌转换 plugin")
  return plugin
}

async function runTransform(plugin: ReturnType<typeof requireBrandPlugin>, code: string, id: string) {
  if (typeof plugin.transform !== "function") throw new Error("品牌 plugin 缺少 transform hook")
  return plugin.transform.call({}, code.replaceAll("\r\n", "\n"), id)
}

async function runTransformIndexHtml(plugin: ReturnType<typeof requireBrandPlugin>, html: string, filename: string) {
  if (!plugin.transformIndexHtml || typeof plugin.transformIndexHtml !== "object") {
    throw new Error("品牌 plugin 缺少 transformIndexHtml hook")
  }
  const handler = plugin.transformIndexHtml.handler
  const result = await handler.call({}, html, { filename, path: "/index.html", server: undefined, bundle: undefined })
  if (typeof result !== "string") throw new Error("HTML transform 未返回字符串")
  return result
}

async function runBuildEnd(plugin: ReturnType<typeof requireBrandPlugin>) {
  if (typeof plugin.buildEnd !== "function") throw new Error("品牌 plugin 缺少 buildEnd hook")
  await plugin.buildEnd.call({})
}

function requireCode(value: Awaited<ReturnType<typeof runTransform>>) {
  if (!value || typeof value === "string" || !("code" in value) || typeof value.code !== "string") {
    throw new Error("模块 transform 未返回 code")
  }
  return value.code
}

function requireLedger(value: unknown) {
  if (!isLedger(value)) throw new Error("统一 ledger 结构无效")
  return value
}

function isLedger(value: unknown): value is { events: Array<{ stage: BrandBuildTarget; file: string; rules: unknown[] }> } {
  return (
    !!value &&
    typeof value === "object" &&
    "events" in value &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        !!event &&
        typeof event === "object" &&
        (event.stage === "main" || event.stage === "preload" || event.stage === "renderer") &&
        typeof event.file === "string" &&
        Array.isArray(event.rules),
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
