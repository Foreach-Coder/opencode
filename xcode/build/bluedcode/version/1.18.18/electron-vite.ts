import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { UserConfig } from "electron-vite"
import type { Plugin, PluginOption } from "vite"
import type { DerivedAssets } from "../../common/assets"
import { deriveRequiredBuildTargets, type VersionAdapter } from "../../common/adapter"
import { selectVersionAdapter, type VersionAdapterSelection } from "../../common/adapter-registry"
import { createBrandPlugins, createBrandTransformSession, type BrandBuildTarget } from "../../common/plugins"
import {
  assertConcreteDirectory,
  assertOptionalSafeDirectory,
  assertSafeDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  publishImmutableFile,
  removeSafeDirectory,
  verifyConcreteFile,
} from "../../common/isolation"
import type { BuildPaths } from "../../common/paths"
import type { ServerArtifact, ServerBundle } from "../../common/server"
import type { BuildIdentity } from "../../common/types"
import { version11818Adapter } from "."

const runtimePublicFiles = [
  "assets/Inter.ttf",
  "assets/JetBrainsMonoNerdFontMono-Regular.woff2",
  "oc-theme-preload.js",
] as const

const brandedPublicFiles = [
  "apple-touch-icon-v3.png",
  "apple-touch-icon.png",
  "favicon-96x96-v3.png",
  "favicon-96x96.png",
  "favicon-v3.ico",
  "favicon-v3.svg",
  "favicon.ico",
  "favicon.svg",
  "site.webmanifest",
  "social-share-zen.png",
  "social-share.png",
  "web-app-manifest-192x192.png",
  "web-app-manifest-512x512.png",
] as const

const nonDesktopPublicFiles = ["_headers"] as const

export const requiredBuildTargets = deriveRequiredBuildTargets(version11818Adapter) satisfies Record<
  BrandBuildTarget,
  readonly string[]
>

export type ElectronViteContext = {
  adapter: VersionAdapter
  assets: DerivedAssets
  identity: BuildIdentity
  paths: BuildPaths
  server: Pick<ServerBundle, "file" | "digest" | "size" | "assets">
}

const commonJsBanner = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`

const childEnvironmentAllowlist = new Set([
  "APPDATA",
  "CI",
  "COLORTERM",
  "COMSPEC",
  "LOCALAPPDATA",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
])

const bundledMainRuntimeDependencies = [
  "@zip.js/zip.js",
  "drizzle-orm",
  "effect",
  "electron-context-menu",
  "electron-log",
  "electron-store",
  "electron-window-state",
] as const

const clearedChildEnvironment = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_RELEASE",
  "VITE_SENTRY_DSN",
  "VITE_SENTRY_RELEASE",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "EP_DRAFT",
  "EP_PRE_RELEASE",
  "NPM_TOKEN",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
] as const

assertRequiredBuildTargets()

export async function createElectronViteConfig(context: ElectronViteContext): Promise<UserConfig> {
  await validateContext(context)
  const publicDir = await stageRendererPublic(context.paths, context.assets)
  const desktopRoot = path.join(context.paths.repositoryRoot, "packages", "desktop")
  const rendererRoot = path.join(desktopRoot, "src", "renderer")
  const electronOut = path.join(context.paths.stageDir, "desktop", "out")
  const ledgerRoot = path.join(context.paths.stageDir, "ledger", "electron")
  const auditRoot = path.join(context.paths.stageDir, "electron-vite", "audits")
  const isolation = await prepareIsolation(context.paths)
  await ensureSafeDirectory(isolation, path.join(context.paths.stageDir, "desktop"))
  await assertOptionalSafeDirectory(isolation, electronOut)
  if (await lstatOptional(electronOut)) await removeSafeDirectory(isolation, electronOut)
  for (const target of [ledgerRoot, auditRoot]) {
    await assertOptionalSafeDirectory(isolation, target)
    if (await lstatOptional(target)) await removeSafeDirectory(isolation, target)
  }
  await ensureSafeDirectory(isolation, electronOut)
  for (const target of ["main", "preload", "renderer"] as const) {
    await ensureSafeDirectory(isolation, path.join(electronOut, target))
  }
  await ensureSafeDirectory(isolation, ledgerRoot)
  await ensureSafeDirectory(isolation, auditRoot)

  const session = createBrandTransformSession(["main", "preload", "renderer"])
  const brandPlugins = (target: BrandBuildTarget) =>
    createBrandPlugins({
      adapter: context.adapter,
      identity: context.identity,
      isolation,
      ledgerRoot,
      repositoryRoot: context.paths.repositoryRoot,
      requiredBuildTargets: requiredBuildTargets[target],
      session,
      target,
    })
  const appPlugin = await loadAppPlugin(context.paths.repositoryRoot)
  const nodePtyPackage = `@lydell/node-pty-${process.platform}-${process.arch}`
  const jsoncParserFile = path.join(
    context.paths.repositoryRoot,
    "packages",
    "opencode",
    "node_modules",
    "jsonc-parser",
    "lib",
    "esm",
    "main.js",
  )
  const jsoncParserStats = await lstat(jsoncParserFile)
  if (jsoncParserStats.isSymbolicLink() || !jsoncParserStats.isFile()) {
    throw new Error(`jsonc-parser bundle 入口不是普通文件: ${jsoncParserFile}`)
  }

  return {
    main: {
      root: desktopRoot,
      envPrefix: "BLUEDCODE_VITE_",
      define: {
        "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(context.identity.channel),
      },
      resolve: {
        alias: {
          "jsonc-parser": jsoncParserFile,
          "virtual:opencode-server": context.server.file,
        },
      },
      build: {
        emptyOutDir: true,
        outDir: path.join(electronOut, "main"),
        rollupOptions: {
          input: {
            index: path.join(desktopRoot, "src", "main", "index.ts"),
            sidecar: path.join(desktopRoot, "src", "main", "sidecar.ts"),
          },
          output: { banner: commonJsBanner },
        },
        externalizeDeps: { include: [nodePtyPackage], exclude: [...bundledMainRuntimeDependencies] },
      },
      plugins: [
        ...brandPlugins("main"),
        nodePtyPlugin(nodePtyPackage),
        virtualServerPlugin(context.server.file),
        serverAssetsPlugin(context.paths.serverDir, context.server, path.join(electronOut, "main")),
      ],
    },
    preload: {
      root: desktopRoot,
      envPrefix: "BLUEDCODE_VITE_",
      build: {
        emptyOutDir: true,
        outDir: path.join(electronOut, "preload"),
        rollupOptions: {
          input: { index: path.join(desktopRoot, "src", "preload", "index.ts") },
          output: {
            entryFileNames: "[name].js",
            format: "cjs",
          },
        },
      },
      plugins: brandPlugins("preload"),
    },
    renderer: {
      root: rendererRoot,
      envPrefix: "BLUEDCODE_VITE_",
      publicDir,
      build: {
        copyPublicDir: true,
        emptyOutDir: true,
        outDir: path.join(electronOut, "renderer"),
        sourcemap: false,
        rollupOptions: {
          input: { main: path.join(rendererRoot, "index.html") },
        },
      },
      plugins: [
        ...brandPlugins("renderer"),
        staticBrandPlugin(),
        appPlugin,
        outputAuditPlugin(isolation, electronOut, auditRoot),
      ],
    },
  }
}

export async function stageRendererPublic(paths: BuildPaths, assets: DerivedAssets) {
  const sourceRoot = path.join(paths.repositoryRoot, "packages", "app", "public")
  await assertConcreteDirectory(paths.repositoryRoot, sourceRoot)
  const source = await readPublicSource(sourceRoot)
  const assetRoot = requireAssetRoot(paths, assets)
  await assertConcreteDirectory(paths.stageDir, assetRoot)
  const derived = new Map(
    await Promise.all(
      [
        ["favicon.ico", assets.iconIco],
        ["favicon.png", assets.faviconPng],
        ["favicon.svg", assets.faviconSvg],
        ["social-share.png", assets.faviconPng],
        ["wordmark.png", assets.wordmarkPng],
        ["wordmark.svg", assets.wordmarkSvg],
      ].map(async ([file, sourceFile]) => [file, await readConcreteFile(assetRoot, sourceFile)] as const),
    ),
  )
  const files = new Map([...source, ...derived])
  const digest = digestFiles(files)
  const isolation = await prepareIsolation(paths)
  const publicRoot = path.join(paths.stageDir, "public")
  const target = path.join(publicRoot, digest)
  await ensureSafeDirectory(isolation, paths.workspaceRoot)
  await ensureSafeDirectory(isolation, paths.stageDir)
  await ensureSafeDirectory(isolation, publicRoot)
  await publishImmutableDirectory(isolation, publicRoot, target, files)
  return target
}

export function createElectronViteChildEnv(
  contextFile: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
  channel: BuildIdentity["channel"] = "dev",
) {
  if (!path.isAbsolute(contextFile)) throw new Error("Electron Vite context file 必须是绝对路径")
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && childEnvironmentAllowlist.has(key.toUpperCase())) environment[key] = value
  }
  environment.BLUEDCODE_ELECTRON_VITE_CONTEXT = contextFile
  environment.OPENCODE_CHANNEL = channel
  for (const key of clearedChildEnvironment) environment[key] = ""
  return environment
}

export async function writeElectronViteContext(context: ElectronViteContext) {
  await validateContext(context)
  const serialized: ElectronViteSerializedContext = {
    ...context,
    adapter: {
      tag: context.adapter.tag,
      commit: context.adapter.commit,
      desktopVersion: context.adapter.desktopVersion,
    },
  }
  const value = `${JSON.stringify(serialized, null, 2)}\n`
  const isolation = await prepareIsolation(context.paths)
  const directory = path.join(context.paths.stageDir, "electron-vite")
  const file = path.join(directory, `context-${createHash("sha256").update(value).digest("hex")}.json`)
  await ensureSafeDirectory(isolation, context.paths.workspaceRoot)
  await ensureSafeDirectory(isolation, context.paths.stageDir)
  await ensureSafeDirectory(isolation, directory)
  const existing = await lstatOptional(file)
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Electron Vite context 不是普通文件")
    if ((await readFile(file, "utf8")) !== value) throw new Error("Electron Vite context 摘要路径内容冲突")
    return file
  }
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporary, value, { flag: "wx" })
  try {
    await rename(temporary, file)
  } catch (error) {
    if (!(await lstatOptional(file))) throw error
    if ((await readFile(file, "utf8")) !== value) throw error
    await Bun.file(temporary).delete()
  }
  return file
}

function nodePtyPlugin(nodePtyPackage: string): Plugin {
  return {
    name: "opencode:node-pty-narrower",
    enforce: "pre",
    resolveId(source) {
      if (source === "@lydell/node-pty") return nodePtyPackage
      return null
    },
  }
}

function virtualServerPlugin(serverFile: string): Plugin {
  return {
    name: "bluedcode:virtual-server-module",
    enforce: "pre",
    resolveId(source) {
      if (source === "virtual:opencode-server") return serverFile
      return null
    },
  }
}

function serverAssetsPlugin(
  serverRoot: string,
  server: Pick<ServerBundle, "file" | "digest" | "size" | "assets">,
  outputRoot: string,
): Plugin {
  return {
    name: "bluedcode:server-assets",
    async buildStart() {
      for (const asset of await verifyServerAssets(serverRoot, server)) {
        this.emitFile({
          type: "asset",
          fileName: `chunks/${path.posix.basename(asset.file)}`,
          source: asset.content,
        })
      }
    },
    async writeBundle() {
      const expected = server.assets.map((asset) => ({ ...asset, file: path.posix.basename(asset.file) }))
      const chunks = path.join(outputRoot, "chunks")
      await assertConcreteDirectory(outputRoot, chunks)
      const actual = (await listConcreteFiles(chunks)).filter((file) => file.endsWith(".wasm"))
      const files = expected.map((asset) => asset.file).sort((left, right) => left.localeCompare(right))
      if (actual.length !== files.length || actual.some((file, index) => file !== files[index])) {
        throw new Error(`main chunks WASM 文件集合不匹配: ${actual.join(", ")}`)
      }
      await Promise.all(
        expected.map(async (asset) => {
          const file = path.join(chunks, asset.file)
          await verifyConcreteFile(chunks, file, asset.digest)
          if ((await lstat(file)).size !== asset.size) throw new Error(`main chunks WASM 大小不匹配: ${asset.file}`)
        }),
      )
    },
  }
}

async function verifyServerAssets(
  serverRoot: string,
  server: Pick<ServerBundle, "file" | "digest" | "size" | "assets">,
) {
  const directory = path.dirname(server.file)
  await assertConcreteDirectory(serverRoot, directory)
  const assets = requireServerAssets(server.assets)
  const actual = (await listConcreteFiles(directory)).filter((file) => file.endsWith(".wasm"))
  const expected = assets.map((asset) => asset.file)
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error(`内嵌 server WASM 文件集合不匹配: ${actual.join(", ")}`)
  }
  return Promise.all(
    assets.map(async (asset) => {
      const file = resolveServerAsset(directory, asset.file)
      const content = await readConcreteFile(directory, file)
      if (content.byteLength !== asset.size) throw new Error(`内嵌 server WASM 大小不匹配: ${asset.file}`)
      if (createHash("sha256").update(content).digest("hex") !== asset.digest) {
        throw new Error(`内嵌 server WASM 摘要不匹配: ${asset.file}`)
      }
      return { ...asset, content }
    }),
  )
}

function requireServerAssets(input: unknown): ServerArtifact[] {
  if (!Array.isArray(input) || !input.length) throw new Error("内嵌 server assets 必须包含至少一个 WASM")
  const assets = input.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`内嵌 server assets[${index}] 无效`)
    }
    if (Object.keys(value).sort().join(",") !== "digest,file,size") {
      throw new Error(`内嵌 server assets[${index}] schema 无效`)
    }
    if (!("file" in value) || typeof value.file !== "string" || !value.file.endsWith(".wasm")) {
      throw new Error(`内嵌 server assets[${index}] file 无效`)
    }
    if (!("digest" in value) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) {
      throw new Error(`内嵌 server assets[${index}] digest 无效`)
    }
    if (!("size" in value) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size <= 0) {
      throw new Error(`内嵌 server assets[${index}] size 无效`)
    }
    requireManifestRelativeFile(value.file)
    return { file: value.file, digest: value.digest, size: value.size }
  })
  const files = assets.map((asset) => asset.file)
  const sorted = [...files].sort((left, right) => left.localeCompare(right))
  const basenames = files.map((file) => path.posix.basename(file))
  if (
    new Set(files).size !== files.length ||
    new Set(basenames).size !== basenames.length ||
    files.some((file, index) => file !== sorted[index])
  ) {
    throw new Error("内嵌 server assets 路径必须唯一、按序且 basename 不冲突")
  }
  return assets
}

function requireManifestRelativeFile(file: string) {
  if (
    !file ||
    file.includes("\0") ||
    file.includes("\\") ||
    path.posix.isAbsolute(file) ||
    /^[a-zA-Z]:/.test(file) ||
    path.posix.normalize(file) !== file ||
    file.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("内嵌 server asset 必须是规范 POSIX relative file")
  }
}

function resolveServerAsset(root: string, file: string) {
  requireManifestRelativeFile(file)
  const target = path.resolve(root, ...file.split("/"))
  requireStrictDescendant(root, target, "内嵌 server asset")
  return target
}

function outputAuditPlugin(
  isolation: Awaited<ReturnType<typeof prepareIsolation>>,
  outputRoot: string,
  auditRoot: string,
): Plugin {
  return {
    name: "bluedcode:output-audit",
    async closeBundle() {
      await assertSafeDirectory(isolation, outputRoot)
      await assertConcreteDirectory(isolation.lexicalRoot, outputRoot)
      const topLevel = await readdir(outputRoot, { withFileTypes: true })
      for (const entry of topLevel) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new Error(`Electron output 顶层不是具体目录: ${entry.name}`)
        }
        await assertConcreteDirectory(outputRoot, path.join(outputRoot, entry.name))
      }
      const directories = topLevel.map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
      const expected = ["main", "preload", "renderer"]
      if (directories.length !== expected.length || directories.some((entry, index) => entry !== expected[index])) {
        throw new Error(`Electron output 顶层集合不匹配: ${directories.join(", ")}`)
      }
      const artifacts = await Promise.all(
        (await listConcreteFiles(outputRoot)).map(async (file) => {
          const content = await readConcreteFile(outputRoot, path.join(outputRoot, ...file.split("/")))
          return {
            file,
            size: content.byteLength,
            digest: createHash("sha256").update(content).digest("hex"),
          }
        }),
      )
      const content = `${JSON.stringify({ version: 1, topLevel: directories, artifacts }, null, 2)}\n`
      const digest = createHash("sha256").update(content).digest("hex")
      await publishImmutableFile(
        isolation,
        auditRoot,
        path.join(auditRoot, `output-audit-${digest}.json`),
        content,
        digest,
      )
    },
  }
}

function staticBrandPlugin(): Plugin {
  const brandLogo = "\0bluedcode:brand-logo.js"
  const brandWordmarkV2 = "\0bluedcode:brand-wordmark-v2.js"
  return {
    name: "bluedcode:static-brand-assets",
    enforce: "pre",
    resolveId(source) {
      if (source === "@opencode-ai/ui/logo") return brandLogo
      if (source === "@opencode-ai/ui/v2/wordmark-v2") return brandWordmarkV2
      return null
    },
    load(id) {
      if (id === brandWordmarkV2) {
        return `
const Image = (component, src, props) => {
  const element = document.createElement("img")
  element.dataset.component = component
  element.src = src
  if (props.class) element.className = props.class
  return element
}
export const WordmarkV2 = (props) => Image("logo-wordmark-v2", "./wordmark.svg", props)
`
      }
      if (id !== brandLogo) return null
      return `
const Image = (component, src, props) => {
  const element = document.createElement("img")
  element.dataset.component = component
  element.src = src
  if (props.class) element.className = props.class
  return element
}
export const Mark = (props) => Image("logo-mark", "./favicon.svg", props)
export const Splash = (props) => Image("logo-splash", "./favicon.svg", props)
export const Logo = (props) => Image("logo-wordmark", "./wordmark.svg", props)
`
    },
  }
}

async function loadAppPlugin(repositoryRoot: string): Promise<PluginOption> {
  const file = path.join(repositoryRoot, "packages", "app", "vite.js")
  const loaded: unknown = await import(pathToFileURL(file).href)
  if (!loaded || typeof loaded !== "object" || !("default" in loaded))
    throw new Error("App Vite plugin 缺少 default export")
  const plugin = loaded.default
  return requirePluginOption(plugin)
}

function requirePluginOption(value: unknown): PluginOption {
  if (Array.isArray(value)) return value.map(requirePluginOption)
  if (isPlugin(value)) return value
  throw new Error("App Vite plugin default export 无效")
}

function isPlugin(value: unknown): value is Plugin {
  return !!value && typeof value === "object" && "name" in value && typeof value.name === "string"
}

async function validateContext(context: ElectronViteContext) {
  if (!context || typeof context !== "object") throw new Error("Electron Vite context 无效")
  if (!context.identity.version.startsWith("1.18.18-")) throw new Error("Electron Vite context 不是 1.18.18")
  const isolation = await prepareIsolation(context.paths)
  for (const directory of [
    context.paths.workspaceRoot,
    context.paths.serverDir,
    context.paths.stageDir,
    context.paths.outDir,
  ]) {
    requireStrictDescendant(context.paths.outputRoot, directory, "Electron Vite 隔离目录")
  }
  await assertSafeDirectory(isolation, context.paths.serverDir)
  requireStrictDescendant(context.paths.serverDir, context.server.file, "server bundle")
  await verifyConcreteFile(context.paths.serverDir, context.server.file, context.server.digest)
  if ((await lstat(context.server.file)).size !== context.server.size) throw new Error("server bundle 大小不匹配")
  await verifyServerAssets(context.paths.serverDir, context.server)
}

async function readPublicSource(sourceRoot: string) {
  const files = await listConcreteFiles(sourceRoot)
  const expected = new Set<string>([...runtimePublicFiles, ...brandedPublicFiles, ...nonDesktopPublicFiles])
  const unknown = files.filter((file) => !expected.has(file))
  const missing = [...expected].filter((file) => !files.includes(file))
  if (unknown.length || missing.length) {
    throw new Error(`1.18.18 public 资源集合未分类: unknown=${unknown.join(",")} missing=${missing.join(",")}`)
  }
  return new Map(
    await Promise.all(
      runtimePublicFiles.map(
        async (file) => [file, await readConcreteFile(sourceRoot, path.join(sourceRoot, file))] as const,
      ),
    ),
  )
}

async function listConcreteFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort()

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`public 资源拒绝符号链接或 junction: ${childRelative}`)
      if (entry.isDirectory()) {
        await assertConcreteDirectory(root, child)
        await visit(child, childRelative)
        continue
      }
      if (!entry.isFile()) throw new Error(`public 资源不是普通文件: ${childRelative}`)
      files.push(childRelative)
    }
  }
}

function requireAssetRoot(paths: BuildPaths, assets: DerivedAssets) {
  const root = path.dirname(assets.iconIco)
  if (
    ![assets.faviconPng, assets.faviconSvg, assets.wordmarkPng, assets.wordmarkSvg].every(
      (file) => path.dirname(file) === root,
    )
  ) {
    throw new Error("Task 5 派生资源不在同一不可变摘要目录")
  }
  requireStrictDescendant(path.join(paths.stageDir, "assets"), root, "Task 5 派生资源")
  return root
}

async function readConcreteFile(root: string, file: string) {
  const parent = path.dirname(file)
  if (path.resolve(parent) !== path.resolve(root)) await assertConcreteDirectory(root, parent)
  const stats = await lstat(file)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`资源不是具体普通文件: ${file}`)
  const content = new Uint8Array(await readFile(file))
  const digest = createHash("sha256").update(content).digest("hex")
  await verifyConcreteFile(root, file, digest)
  return content
}

function digestFiles(files: ReadonlyMap<string, Uint8Array>) {
  const digest = createHash("sha256")
  for (const [file, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(file).update("\0").update(content).update("\0")
  }
  return digest.digest("hex")
}

async function publishImmutableDirectory(
  isolation: Awaited<ReturnType<typeof prepareIsolation>>,
  root: string,
  target: string,
  files: ReadonlyMap<string, Uint8Array>,
) {
  if (await lstatOptional(target)) {
    await verifyImmutableDirectory(root, target, files)
    return
  }
  const temporary = path.join(root, `.tmp-${path.basename(target)}-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, temporary)
  try {
    for (const [file, content] of files) {
      const output = path.join(temporary, ...file.split("/"))
      await ensureSafeDirectory(isolation, path.dirname(output))
      await writeFile(output, content, { flag: "wx" })
    }
    await verifyImmutableDirectory(root, temporary, files)
    try {
      await rename(temporary, target)
    } catch (error) {
      if (!(await lstatOptional(target))) throw error
      await verifyImmutableDirectory(root, target, files)
      await removeSafeDirectory(isolation, temporary)
      return
    }
    await verifyImmutableDirectory(root, target, files)
  } catch (error) {
    if (await lstatOptional(temporary)) await removeSafeDirectory(isolation, temporary)
    throw error
  }
}

async function verifyImmutableDirectory(root: string, target: string, files: ReadonlyMap<string, Uint8Array>) {
  await assertConcreteDirectory(root, target)
  const actual = await listConcreteFiles(target)
  const expected = [...files.keys()].sort()
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error("不可变 public stage 文件集合不完整")
  }
  await Promise.all(
    [...files].map(([file, content]) =>
      verifyConcreteFile(
        target,
        path.join(target, ...file.split("/")),
        createHash("sha256").update(content).digest("hex"),
      ),
    ),
  )
}

function requireStrictDescendant(root: string, target: string, label: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须是 trusted root 的严格后代: ${target}`)
  }
}

async function lstatOptional(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function assertRequiredBuildTargets() {
  for (const [target, files] of Object.entries(requiredBuildTargets)) {
    if (new Set(files).size !== files.length) throw new Error(`${target} requiredBuildTargets 存在重复路径`)
    const missing = files.filter((file) => !version11818Adapter.fingerprints[file])
    if (missing.length)
      throw new Error(`${target} requiredBuildTargets 缺少 1.18.18 fingerprint: ${missing.join(", ")}`)
  }
}

async function loadContextFromEnvironment() {
  const file = process.env.BLUEDCODE_ELECTRON_VITE_CONTEXT
  if (!file || !path.isAbsolute(file)) throw new Error("缺少绝对 BLUEDCODE_ELECTRON_VITE_CONTEXT")
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
  if (!isElectronViteSerializedContext(parsed)) throw new Error("Electron Vite context JSON 无效")
  return { ...parsed, adapter: selectVersionAdapter(parsed.adapter) }
}

type ElectronViteSerializedContext = Omit<ElectronViteContext, "adapter"> & { adapter: VersionAdapterSelection }

function isElectronViteSerializedContext(value: unknown): value is ElectronViteSerializedContext {
  if (!value || typeof value !== "object") return false
  if (
    !("adapter" in value) ||
    !("assets" in value) ||
    !("identity" in value) ||
    !("paths" in value) ||
    !("server" in value)
  )
    return false
  if (!hasStringFields(value.adapter, ["tag", "commit", "desktopVersion"])) return false
  if (!hasStringFields(value.assets, ["iconIco", "faviconSvg", "faviconPng", "wordmarkPng", "wordmarkSvg"])) {
    return false
  }
  if (!hasStringFields(value.server, ["file", "digest"])) return false
  if (!("size" in value.server) || typeof value.server.size !== "number") return false
  if (!("assets" in value.server) || !Array.isArray(value.server.assets)) return false
  if (
    !hasStringFields(value.identity, [
      "channel",
      "name",
      "appId",
      "protocol",
      "version",
      "commit",
      "shortCommit",
      "artifactName",
    ])
  ) {
    return false
  }
  if (value.identity.channel !== "dev" && value.identity.channel !== "prod") return false
  if (value.identity.name !== "BluedCode" && value.identity.name !== "BluedCode Dev") return false
  if (value.identity.appId !== "ai.bluedcode.desktop" && value.identity.appId !== "ai.bluedcode.desktop.dev")
    return false
  if (value.identity.protocol !== "bluedcode" && value.identity.protocol !== "bluedcode-dev") return false
  return hasStringFields(value.paths, [
    "repositoryRoot",
    "frameworkRoot",
    "versionRoot",
    "outputRoot",
    "cacheRoot",
    "workspaceRoot",
    "serverDir",
    "stageDir",
    "outDir",
    "artifactsDir",
    "serverEntry",
    "bunLockFile",
    "opencodePackageFile",
    "desktopPackageFile",
    "snapshotManifestFile",
  ])
}

function hasStringFields<const Key extends string>(value: unknown, keys: readonly Key[]): value is Record<Key, string> {
  return !!value && typeof value === "object" && keys.every((key) => key in value && typeof value[key] === "string")
}

export default async function electronViteConfig() {
  return createElectronViteConfig(await loadContextFromEnvironment())
}
