import { createHash } from "node:crypto"
import { cp, lstat, readdir, readFile, rename } from "node:fs/promises"
import path from "node:path"
import { cacheKey, withCache, type CacheIsolation, type CacheKeyInput } from "./cache"
import {
  assertConcreteDirectory,
  assertOptionalSafeDirectory,
  assertSafeDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  removeSafeDirectory,
  verifyConcreteFile,
} from "./isolation"
import type { BuildPaths } from "./paths"
import { writeUnifiedLedger } from "./ledger"
import type { BuildBaseline, BuildIdentity } from "./types"
import { adapter11818 } from "../version/1.18.18"

type ServerCacheValue = {
  file: string
  digest: string
  size: number
  sourceMap: ServerArtifact
  assets: ServerArtifact[]
}

export type ServerArtifact = {
  file: string
  digest: string
  size: number
}

export type ServerBundle = {
  file: string
  digest: string
  size: number
  sourceMap: ServerArtifact
  assets: ServerArtifact[]
  cacheHit: boolean
  cacheKey: string
  version: string
  channel: "desktop"
  defines: {
    OPENCODE_VERSION: string
    OPENCODE_CHANNEL: "'desktop'"
  }
  inputs: CacheKeyInput
  ledgerFile: string
}

export async function buildServer(
  paths: BuildPaths,
  identity: BuildIdentity,
  baseline: BuildBaseline,
): Promise<ServerBundle> {
  const version = requireBaselineIdentity(identity, baseline)
  requireVersionRoot(paths, version)
  const isolation = await prepareIsolation(paths)
  await ensureSafeDirectory(isolation, paths.workspaceRoot)
  await ensureSafeDirectory(isolation, paths.serverDir)
  await ensureSafeDirectory(isolation, paths.cacheRoot)
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("内嵌 server 仅支持 Windows x64")
  }

  const [opencodePackage, desktopPackage] = await Promise.all([
    readPackage(paths.opencodePackageFile),
    readPackage(paths.desktopPackageFile),
  ])
  requirePackageVersions(version, opencodePackage.version, desktopPackage.version)
  const [modelsData, lock, frameworkDigest, adapterDigest, entry] = await Promise.all([
    loadModelsData(),
    readFile(paths.bunLockFile),
    digestFramework(paths),
    digestTree(paths.versionRoot, new Set(["tests"])),
    readFile(paths.serverEntry),
  ])
  const electronVersion = requireElectronVersion(desktopPackage)
  const defines = {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_CHANNEL: "'desktop'" as const,
  }
  const inputs: CacheKeyInput = {
    unit: "server",
    identity,
    commit: identity.commit,
    bunLockDigest: digest(lock),
    bunVersion: Bun.version,
    electronVersion,
    platform: "win32",
    arch: "x64",
    frameworkDigest,
    adapterDigest,
    inputDigest: digest(
      Buffer.concat([
        entry,
        Buffer.from(modelsData),
        Buffer.from(
          JSON.stringify({
            target: "node",
            format: "esm",
            sourcemap: "linked",
            external: ["jsonc-parser", "@lydell/node-pty"],
            files: { "opencode-web-ui.gen.ts": "" },
            artifactManifest: 2,
            ...defines,
          }),
        ),
      ]),
    ),
  }
  const key = cacheKey(inputs)
  const unit = path.join(paths.cacheRoot, "server")
  await ensureSafeDirectory(isolation, unit)
  await assertOptionalSafeDirectory(isolation, path.join(unit, key))
  const cached = await withCache<unknown>(
    unit,
    key,
    async (directory) => {
      await assertSafeDirectory(isolation, directory)
      const payload = path.join(directory, "payload")
      await ensureSafeDirectory(isolation, payload)
      const output = await Bun.build({
        target: "node",
        entrypoints: [paths.serverEntry],
        outdir: payload,
        format: "esm",
        sourcemap: "linked",
        external: ["jsonc-parser", "@lydell/node-pty"],
        define: {
          OPENCODE_MODELS_DEV: modelsData,
          ...defines,
        },
        files: {
          "opencode-web-ui.gen.ts": "",
        },
      })
      if (!output.success) throw new Error(`内嵌 server 打包失败: ${output.logs.map(String).join("\n")}`)
      const file = output.outputs.find((artifact) => artifact.path.endsWith(".js"))
      if (!file) throw new Error("内嵌 server 打包未生成 JavaScript entry")
      return describeServerPayload(payload, file.path)
    },
    isolation,
  )
  await assertSafeDirectory(isolation, cached.directory)
  const value = requireServerCacheValue(cached.value)
  const file = await materializeServer(paths, isolation, key, cached.directory, value)
  const contract = adapter11818.modules.find((module) => module.stage === "server")
  if (!contract) throw new Error("1.18.18 缺少 server ModuleContract")
  // Electron Vite clears only its own evidence directory before rebuilding;
  // keeping server evidence here prevents that cleanup from erasing it.
  const ledgerRoot = path.join(paths.stageDir, "ledger", "server")
  await ensureSafeDirectory(isolation, paths.stageDir)
  await ensureSafeDirectory(isolation, ledgerRoot)
  const ledger = await writeUnifiedLedger({
    isolation,
    root: ledgerRoot,
    events: [
      {
        stage: "server",
        moduleId: contract.id,
        file: contract.file,
        inputSha256: digest(entry),
        outputSha256: value.digest,
        rules: [],
        productProfileSha256: adapter11818.productProfileSha256,
      },
    ],
  })
  return {
    file,
    digest: value.digest,
    size: value.size,
    sourceMap: value.sourceMap,
    assets: value.assets,
    cacheHit: cached.hit,
    cacheKey: key,
    version,
    channel: "desktop",
    defines,
    inputs,
    ledgerFile: ledger.file,
  }
}

async function materializeServer(
  paths: BuildPaths,
  isolation: CacheIsolation,
  key: string,
  cacheDirectory: string,
  value: ServerCacheValue,
) {
  const payload = path.join(cacheDirectory, "payload")
  await assertSafeDirectory(isolation, payload)
  await assertConcreteDirectory(cacheDirectory, payload)
  await verifyServerPayload(payload, value)
  await ensureSafeDirectory(isolation, paths.serverDir)
  const target = path.join(paths.serverDir, key)
  if (await pathExists(target)) {
    await assertSafeDirectory(isolation, target)
    await assertConcreteDirectory(paths.serverDir, target)
    await verifyServerPayload(target, value)
    return resolveManifestFile(target, value.file)
  }

  const temporary = path.join(paths.serverDir, `.tmp-${key}-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, temporary)
  await assertConcreteDirectory(paths.serverDir, temporary)
  try {
    await copyServerPayload(payload, temporary, value, isolation)
    await assertSafeDirectory(isolation, temporary)
    await assertConcreteDirectory(paths.serverDir, temporary)
    await verifyServerPayload(temporary, value)
  } catch (error) {
    await removeSafeDirectory(isolation, temporary)
    throw error
  }

  try {
    await rename(temporary, target)
  } catch (error) {
    if (!(await pathExists(target))) {
      await removeSafeDirectory(isolation, temporary)
      throw error
    }
    await assertSafeDirectory(isolation, target)
    await assertConcreteDirectory(paths.serverDir, target)
    await verifyServerPayload(target, value)
    await removeSafeDirectory(isolation, temporary)
  }
  await assertSafeDirectory(isolation, target)
  await assertConcreteDirectory(paths.serverDir, target)
  await verifyServerPayload(target, value)
  return resolveManifestFile(target, value.file)
}

async function copyServerPayload(source: string, target: string, value: ServerCacheValue, isolation: CacheIsolation) {
  const files = serverArtifacts(value).map((artifact) => artifact.file)
  await Promise.all(
    files.map(async (file) => {
      const output = resolveManifestFile(target, file)
      await ensureSafeDirectory(isolation, path.dirname(output))
      await cp(resolveManifestFile(source, file), output, { errorOnExist: true, force: false })
    }),
  )
}

async function describeServerPayload(root: string, entry: string): Promise<ServerCacheValue> {
  const file = path.relative(root, entry).replaceAll("\\", "/")
  requireManifestRelativeFile(file)
  const actual = await listServerPayloadFiles(root)
  const assetFiles = actual.filter((item) => item.endsWith(".wasm"))
  if (!assetFiles.length) throw new Error("1.18.18 内嵌 server 必须生成至少一个 WASM 资产")
  const expected = [file, `${file}.map`, ...assetFiles].sort((left, right) => left.localeCompare(right))
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`内嵌 server payload 文件集合未认证: ${actual.join(", ")}`)
  }
  const [entryArtifact, sourceMap, ...assets] = await Promise.all(
    [file, `${file}.map`, ...assetFiles].map((item) => describeServerArtifact(root, item)),
  )
  return {
    file: entryArtifact.file,
    digest: entryArtifact.digest,
    size: entryArtifact.size,
    sourceMap,
    assets,
  }
}

async function describeServerArtifact(root: string, file: string): Promise<ServerArtifact> {
  const absolute = resolveManifestFile(root, file)
  const stats = await lstat(absolute)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`内嵌 server 产物不是普通文件: ${file}`)
  const content = await readFile(absolute)
  const descriptor = { file, digest: digest(content), size: content.byteLength }
  await verifyConcreteFile(root, absolute, descriptor.digest)
  return descriptor
}

async function verifyServerPayload(root: string, value: ServerCacheValue) {
  const actual = await listServerPayloadFiles(root)
  const expected = serverArtifacts(value)
    .map((artifact) => artifact.file)
    .sort((left, right) => left.localeCompare(right))
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error(`内嵌 server payload 文件集合不匹配: ${actual.join(", ")}`)
  }
  await Promise.all(
    serverArtifacts(value).map(async (artifact) => {
      const file = resolveManifestFile(root, artifact.file)
      await verifyConcreteFile(root, file, artifact.digest)
      if ((await lstat(file)).size !== artifact.size) throw new Error(`内嵌 server 产物大小不匹配: ${artifact.file}`)
    }),
  )
}

function serverArtifacts(value: ServerCacheValue): ServerArtifact[] {
  return [{ file: value.file, digest: value.digest, size: value.size }, value.sourceMap, ...value.assets]
}

async function listServerPayloadFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort((left, right) => left.localeCompare(right))

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`内嵌 server payload 拒绝符号链接或 junction: ${childRelative}`)
      if (entry.isDirectory()) {
        await assertConcreteDirectory(root, child)
        await visit(child, childRelative)
        continue
      }
      if (!entry.isFile()) throw new Error(`内嵌 server payload 不是普通文件: ${childRelative}`)
      files.push(childRelative)
    }
  }
}

async function loadModelsData() {
  if (process.env.MODELS_DEV_API_JSON) return readFile(process.env.MODELS_DEV_API_JSON, "utf8")
  return fetch(`${process.env.OPENCODE_MODELS_URL || "https://models.dev"}/api.json`).then((response) =>
    response.text(),
  )
}

async function digestFramework(paths: BuildPaths) {
  const snapshot: unknown = JSON.parse(await readFile(paths.snapshotManifestFile, "utf8"))
  if (!snapshot || typeof snapshot !== "object" || !("frameworkVersion" in snapshot) || !("files" in snapshot)) {
    throw new Error("公共框架快照无效")
  }
  if (!snapshot.files || typeof snapshot.files !== "object" || Array.isArray(snapshot.files)) {
    throw new Error("公共框架快照无效")
  }
  const files = Object.fromEntries(Object.entries(snapshot.files).filter(([file]) => file !== "tui.json"))
  return digest(
    JSON.stringify({
      common: await digestTree(path.join(paths.frameworkRoot, "common")),
      frameworkVersion: snapshot.frameworkVersion,
      files,
    }),
  )
}

async function digestTree(root: string, ignoredDirectories = new Set<string>()) {
  const files = await listFiles(root, ignoredDirectories)
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll("\\", "/"))
    hash.update("\0")
    hash.update(await readFile(file))
    hash.update("\0")
  }
  return hash.digest("hex")
}

async function listFiles(root: string, ignoredDirectories: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(root, entry.name)
      if (entry.isFile()) return [absolute]
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []
      if (entry.isDirectory()) return listFiles(absolute, ignoredDirectories)
      throw new Error(`构建摘要拒绝非普通文件: ${absolute}`)
    }),
  )
  return files.flat().sort((left, right) => left.localeCompare(right))
}

async function readPackage(file: string) {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || typeof parsed.version !== "string") {
    throw new Error(`${file} 缺少 version`)
  }
  return { ...parsed, version: parsed.version }
}

function requireBaselineIdentity(identity: BuildIdentity, baseline: BuildBaseline) {
  if (!/^\d+\.\d+\.\d+$/.test(baseline.desktopVersion)) throw new Error("受信版本基线无效")
  const identityVersion = /^\d+\.\d+\.\d+/.exec(identity.version)?.[0]
  if (identityVersion !== baseline.desktopVersion) throw new Error("构建身份与受信版本基线不匹配")
  return baseline.desktopVersion
}

function requirePackageVersions(version: string, opencodeVersion: string, desktopVersion: string) {
  if (opencodeVersion !== version || desktopVersion !== version) {
    throw new Error("内嵌 server package 版本与受信版本基线不匹配")
  }
}

function requireVersionRoot(paths: BuildPaths, version: string) {
  const expected = path.join(paths.frameworkRoot, "version", version)
  if (path.relative(expected, paths.versionRoot) !== "") throw new Error("server adapter 路径与受信版本基线不匹配")
}

function requireElectronVersion(desktopPackage: object) {
  if (!("devDependencies" in desktopPackage) || !desktopPackage.devDependencies) {
    throw new Error("Desktop package.json 缺少 Electron 版本")
  }
  if (
    typeof desktopPackage.devDependencies !== "object" ||
    !("electron" in desktopPackage.devDependencies) ||
    typeof desktopPackage.devDependencies.electron !== "string"
  ) {
    throw new Error("Desktop package.json 缺少 Electron 版本")
  }
  return desktopPackage.devDependencies.electron
}

function requireServerCacheValue(input: unknown): ServerCacheValue {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("server cache manifest 无效")
  const keys = Object.keys(input).sort()
  if (keys.join(",") !== "assets,digest,file,size,sourceMap") throw new Error("server cache manifest schema 无效")
  if (!("file" in input) || typeof input.file !== "string") throw new Error("server cache manifest file 无效")
  if (!("digest" in input) || typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new Error("server cache manifest digest 无效")
  }
  if (!("size" in input) || !isArtifactSize(input.size)) throw new Error("server cache manifest size 无效")
  if (!("sourceMap" in input)) throw new Error("server cache manifest sourceMap 无效")
  if (!("assets" in input) || !Array.isArray(input.assets)) throw new Error("server cache manifest assets 无效")
  requireManifestRelativeFile(input.file)
  if (!input.file.endsWith(".js")) throw new Error("server cache manifest entry 必须是 JavaScript")
  const sourceMap = requireServerArtifact(input.sourceMap, "sourceMap")
  if (sourceMap.file !== `${input.file}.map`) throw new Error("server cache manifest sourceMap 路径无效")
  const assets = input.assets.map((asset, index) => requireServerArtifact(asset, `assets[${index}]`))
  if (!assets.length) throw new Error("server cache manifest 必须包含至少一个 WASM 资产")
  if (assets.some((asset) => !asset.file.endsWith(".wasm"))) {
    throw new Error("server cache manifest assets 只能包含 WASM")
  }
  const files = assets.map((asset) => asset.file)
  const sorted = [...files].sort((left, right) => left.localeCompare(right))
  if (new Set(files).size !== files.length || files.some((file, index) => file !== sorted[index])) {
    throw new Error("server cache manifest assets 必须唯一且排序")
  }
  return { file: input.file, digest: input.digest, size: input.size, sourceMap, assets }
}

function requireServerArtifact(input: unknown, label: string): ServerArtifact {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`server cache manifest ${label} 无效`)
  }
  if (Object.keys(input).sort().join(",") !== "digest,file,size") {
    throw new Error(`server cache manifest ${label} schema 无效`)
  }
  if (!("file" in input) || typeof input.file !== "string") {
    throw new Error(`server cache manifest ${label} file 无效`)
  }
  if (!("digest" in input) || typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new Error(`server cache manifest ${label} digest 无效`)
  }
  if (!("size" in input) || !isArtifactSize(input.size)) {
    throw new Error(`server cache manifest ${label} size 无效`)
  }
  requireManifestRelativeFile(input.file)
  return { file: input.file, digest: input.digest, size: input.size }
}

function isArtifactSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
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
    throw new Error("server cache manifest file 必须是规范 POSIX relative file")
  }
}

function resolveManifestFile(root: string, file: string) {
  requireManifestRelativeFile(file)
  const target = path.resolve(root, ...file.split("/"))
  const relative = path.relative(path.resolve(root), target)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("server cache manifest file 越出具体 payload root")
  }
  return target
}

async function pathExists(target: string) {
  return (await lstatOptional(target)) !== undefined
}

async function lstatOptional(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined
    throw error
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function digest(value: string | Buffer | ArrayBuffer) {
  return createHash("sha256")
    .update(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
    .digest("hex")
}
