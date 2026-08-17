import { createHash } from "node:crypto"
import { lstat, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises"
import { createRequire, isBuiltin } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { AfterPackContext, Configuration } from "electron-builder"
import type { DerivedAssets } from "../../common/assets"
import { assertConcreteDirectory } from "../../common/isolation"
import type { BuildPaths } from "../../common/paths"
import type { BuildIdentity } from "../../common/types"
import {
  resourceEditorLock,
  type LockedResourceEditorFile,
  type LockedResourceEditorPackage,
} from "./resource-editor-lock"

export { resourceEditorLock } from "./resource-editor-lock"

export type WindowsPeMetadata = {
  productName: string
  productVersion: string
  fileVersion: string
  numericFileVersion: string
  numericProductVersion: string
  signatureStatus: string
}

export type BrandedExecutableResourceAudit = {
  target: string
  tool: typeof resourceEditorLock
  before: WindowsPeMetadata
  after: WindowsPeMetadata
  iconResources: { beforeSha256: string; afterSha256: string }
  nonVersionResources: { beforeSha256: string; afterSha256: string }
  passed: true
}

export type VersionResourceEditInput = {
  executable: string
  fullVersion: string
  numericVersion: string
}

export type VersionResourceEditEvidence = Pick<
  BrandedExecutableResourceAudit,
  "tool" | "iconResources" | "nonVersionResources"
>

export type BrandedExecutableVersionOperations = {
  readPeMetadata(file: string): Promise<WindowsPeMetadata>
  editVersionResource(input: VersionResourceEditInput): Promise<VersionResourceEditEvidence>
}

export const nativeRuntimeFiles = [
  "package.json",
  "lib/conpty_console_list_agent.js",
  "lib/eventEmitter2.js",
  "lib/index.js",
  "lib/interfaces.js",
  "lib/shared/conout.js",
  "lib/terminal.js",
  "lib/types.js",
  "lib/utils.js",
  "lib/windowsConoutConnection.js",
  "lib/windowsPtyAgent.js",
  "lib/windowsTerminal.js",
  "lib/worker/conoutSocketWorker.js",
  "prebuilds/win32-x64/conpty.node",
  "prebuilds/win32-x64/conpty_console_list.node",
  "prebuilds/win32-x64/conpty/conpty.dll",
  "prebuilds/win32-x64/conpty/OpenConsole.exe",
] as const

export type BuilderContext = {
  arch: string
  afterSign: (context: AfterPackContext) => Promise<void>
  assets: DerivedAssets
  electronVersion: string
  identity: BuildIdentity
  nativePackageDir: string
  paths: BuildPaths
  platform: string
}

export function createBuilderConfig(context: BuilderContext): Configuration {
  requireBuilderContext(context)
  const assetRoot = path.dirname(context.assets.iconIco)
  return {
    afterSign: context.afterSign,
    appId: context.identity.appId,
    productName: context.identity.name,
    artifactName: context.identity.artifactName,
    asar: { smartUnpack: true },
    asarUnpack: nativeRuntimeFiles
      .filter((file) => /\.(?:dll|exe|node)$/.test(file))
      .map((file) => `node_modules/@lydell/node-pty-win32-x64/${file}`),
    buildDependenciesFromSource: false,
    buildVersion: context.identity.version,
    copyright: "Copyright © ForeachCode",
    directories: {
      app: path.join(context.paths.stageDir, "package"),
      buildResources: assetRoot,
      output: context.paths.outDir,
    },
    electronVersion: context.electronVersion,
    extraMetadata: {
      author: { name: "ForeachCode" },
      description: "BluedCode Windows Desktop",
      main: "out/main/index.js",
      name: context.identity.channel === "prod" ? "bluedcode-desktop" : "bluedcode-desktop-dev",
      productName: context.identity.name,
      type: "module",
      version: context.identity.version,
    },
    files: [
      "package.json",
      "!**/node_modules/**/*",
      ...nativeRuntimeFiles.map((file) => `node_modules/@lydell/node-pty-win32-x64/${file}`),
      {
        from: path.join(context.paths.stageDir, "desktop", "out"),
        to: "out",
        filter: ["main/**/*", "preload/**/*", "renderer/**/*"],
      },
      {
        from: assetRoot,
        to: "assets",
        filter: ["favicon.png", "favicon.svg", "icon.ico", "wordmark.svg"],
      },
    ],
    forceCodeSigning: false,
    npmRebuild: false,
    nodeGypRebuild: false,
    protocols: { name: context.identity.name, schemes: [context.identity.protocol] },
    publish: null,
    removePackageKeywords: true,
    removePackageScripts: true,
    win: {
      forceCodeSigning: false,
      icon: context.assets.iconIco,
      signExecutable: false,
      signExts: null,
      target: [{ target: "dir", arch: ["x64"] }],
      verifyUpdateCodeSignature: false,
    },
  }
}

export function createBrandedExecutableVersionHook(input: {
  identity: BuildIdentity
  operations: BrandedExecutableVersionOperations
  paths: BuildPaths
}) {
  requireIdentity(input.identity)
  let audit: BrandedExecutableResourceAudit | undefined
  let invoked = false
  const afterSign = async (context: AfterPackContext) => {
    if (invoked) throw new Error("electron-builder afterSign 品牌 EXE 资源处理必须且只能执行一次")
    invoked = true
    await validateAfterPackContext(context, input.identity, input.paths)
    const appOutDir = path.join(input.paths.outDir, "win-unpacked")
    const executableName = `${input.identity.name}.exe`
    const entries = await readdir(appOutDir, { withFileTypes: true })
    if (entries.some((entry) => entry.isSymbolicLink())) {
      throw new Error("electron-builder afterSign appOutDir 拒绝符号链接、junction 或 reparse point")
    }
    const executableEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".exe"))
    if (
      executableEntries.length !== 1 ||
      executableEntries[0]?.name !== executableName ||
      !executableEntries[0].isFile()
    ) {
      throw new Error(
        `electron-builder afterSign 必须包含唯一品牌 EXE 文件名 ${executableName}: ${executableEntries.map((entry) => entry.name).join(", ")}`,
      )
    }
    const executable = path.join(appOutDir, executableName)
    await requireConcreteExecutable(appOutDir, executable)
    const before = requirePeMetadata(await input.operations.readPeMetadata(executable), "修改前")
    requireExactMetadata(before, expectedBuilderMetadata(input.identity), "修改前 Builder 26.15.2")

    const evidence = requireEditEvidence(
      await input.operations.editVersionResource({
        executable,
        fullVersion: input.identity.version,
        numericVersion: deriveWindowsVersion(input.identity),
      }),
    )
    const after = requirePeMetadata(await input.operations.readPeMetadata(executable), "修改后")
    requireExactMetadata(after, expectedBrandedMetadata(input.identity), "修改后")
    if (
      evidence.iconResources.beforeSha256 !== evidence.iconResources.afterSha256 ||
      evidence.nonVersionResources.beforeSha256 !== evidence.nonVersionResources.afterSha256
    ) {
      throw new Error("electron-builder afterSign 修改后 icon 或非 VERSION 资源发生变化")
    }
    audit = {
      target: `win-unpacked/${executableName}`,
      tool: evidence.tool,
      before,
      after,
      iconResources: evidence.iconResources,
      nonVersionResources: evidence.nonVersionResources,
      passed: true,
    }
  }
  return {
    afterSign,
    requireAudit() {
      if (!audit) throw new Error("electron-builder afterSign 品牌 EXE 资源审计缺失")
      return audit
    },
  }
}

export function createReseditVersionOperations(input: {
  moduleFile: string
  readPeMetadata(file: string): Promise<WindowsPeMetadata>
  repositoryRoot: string
}): BrandedExecutableVersionOperations {
  return {
    readPeMetadata: (file) => input.readPeMetadata(file),
    editVersionResource: (edit) => editVersionResource(input.repositoryRoot, input.moduleFile, edit),
  }
}

async function validateAfterPackContext(context: AfterPackContext, identity: BuildIdentity, paths: BuildPaths) {
  if (!context || typeof context !== "object") throw new Error("electron-builder afterSign context 无效")
  if (context.electronPlatformName !== "win32") throw new Error("electron-builder afterSign 仅允许 Windows")
  if (context.arch !== 1) throw new Error("electron-builder afterSign 仅允许 x64")
  if (context.targets.length !== 1 || context.targets[0]?.name !== "dir") {
    throw new Error("electron-builder afterSign target 必须唯一且为 dir")
  }
  requirePackagerIdentity(context.packager, identity)
  const expectedOutDir = path.resolve(paths.outDir)
  const expectedAppOutDir = path.join(expectedOutDir, "win-unpacked")
  if (!samePath(context.outDir, expectedOutDir) || !samePath(context.appOutDir, expectedAppOutDir)) {
    throw new Error("electron-builder afterSign output 路径不匹配或逃逸")
  }
  if (!isStrictDescendant(paths.outputRoot, expectedOutDir)) {
    throw new Error("electron-builder afterSign output 路径逃逸隔离根")
  }
  await assertConcreteDirectory(paths.outputRoot, expectedOutDir)
  await assertConcreteDirectory(expectedOutDir, expectedAppOutDir)
  if (
    !(await sameCanonicalPath(expectedOutDir, context.outDir)) ||
    !(await sameCanonicalPath(expectedAppOutDir, context.appOutDir))
  ) {
    throw new Error("electron-builder afterSign canonical output 路径不匹配")
  }
}

function requirePackagerIdentity(packager: unknown, identity: BuildIdentity) {
  if (!packager || typeof packager !== "object" || Array.isArray(packager)) {
    throw new Error("electron-builder afterSign packager context 无效")
  }
  const platform = "platform" in packager ? packager.platform : undefined
  const appInfo = "appInfo" in packager ? packager.appInfo : undefined
  const config = "config" in packager ? packager.config : undefined
  if (
    !platform ||
    typeof platform !== "object" ||
    !("name" in platform) ||
    platform.name !== "windows" ||
    !("nodeName" in platform) ||
    platform.nodeName !== "win32" ||
    !("buildConfigurationKey" in platform) ||
    platform.buildConfigurationKey !== "win"
  ) {
    throw new Error("electron-builder afterSign packager platform context 无效")
  }
  if (
    !appInfo ||
    typeof appInfo !== "object" ||
    !("productName" in appInfo) ||
    appInfo.productName !== identity.name ||
    !("version" in appInfo) ||
    appInfo.version !== identity.version
  ) {
    throw new Error("electron-builder afterSign packager 产品身份无效")
  }
  if (!config || typeof config !== "object" || !("appId" in config) || config.appId !== identity.appId) {
    throw new Error("electron-builder afterSign packager appId 无效")
  }
}

function expectedBuilderMetadata(identity: BuildIdentity): WindowsPeMetadata {
  const baseVersion = requireBaseVersion(identity.version)
  const [major, minor] = baseVersion.split(".")
  return {
    productName: identity.name,
    productVersion: `${baseVersion}.0`,
    fileVersion: identity.version,
    numericFileVersion: `${major}.${minor}.0.0`,
    numericProductVersion: `${baseVersion}.0`,
    signatureStatus: "NotSigned",
  }
}

function expectedBrandedMetadata(identity: BuildIdentity): WindowsPeMetadata {
  const numericVersion = deriveWindowsVersion(identity)
  return {
    productName: identity.name,
    productVersion: identity.version,
    fileVersion: identity.version,
    numericFileVersion: numericVersion,
    numericProductVersion: numericVersion,
    signatureStatus: "NotSigned",
  }
}

async function editVersionResource(
  repositoryRoot: string,
  moduleFile: string,
  input: VersionResourceEditInput,
): Promise<VersionResourceEditEvidence> {
  await authenticateResourceEditor(repositoryRoot, moduleFile)
  const loaded: unknown = await import(pathToFileURL(moduleFile).href)
  const resedit = requireResedit(loaded)
  const source = await readFile(input.executable)
  const executable = resedit.NtExecutable.from(source)
  const resources = resedit.NtExecutableResource.from(executable)
  const versions = resedit.Resource.VersionInfo.fromEntries(resources.entries)
  if (versions.length !== 1) throw new Error(`resedit 版本资源必须唯一: ${versions.length}`)
  const languages = versions[0].getAllLanguagesForStringValues()
  if (languages.length !== 1) throw new Error(`resedit 版本字符串语言必须唯一: ${languages.length}`)
  const preservedStrings = omitMutableVersionStrings(versions[0].getStringValues(languages[0]))
  const beforeIcon = digestResourceEntries(resources.entries, new Set([3, 14]), true)
  const beforeNonVersion = digestResourceEntries(resources.entries, new Set([16]), false)
  versions[0].setFileVersion(input.numericVersion)
  versions[0].setProductVersion(input.numericVersion)
  versions[0].setStringValues(languages[0], {
    FileVersion: input.fullVersion,
    ProductVersion: input.fullVersion,
  })
  versions[0].outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  const generated = Buffer.from(executable.generate())
  const generatedExecutable = resedit.NtExecutable.from(generated)
  const generatedResources = resedit.NtExecutableResource.from(generatedExecutable)
  const generatedVersions = resedit.Resource.VersionInfo.fromEntries(generatedResources.entries)
  if (generatedVersions.length !== 1) throw new Error("resedit 生成后版本资源不唯一")
  const generatedLanguages = generatedVersions[0].getAllLanguagesForStringValues()
  if (generatedLanguages.length !== 1) throw new Error("resedit 生成后版本字符串语言不唯一")
  const strings = generatedVersions[0].getStringValues(generatedLanguages[0])
  if (strings.FileVersion !== input.fullVersion || strings.ProductVersion !== input.fullVersion) {
    throw new Error("resedit 生成后未保留完整 FileVersion/ProductVersion")
  }
  if (JSON.stringify(omitMutableVersionStrings(strings)) !== JSON.stringify(preservedStrings)) {
    throw new Error("resedit 修改了 ProductVersion/FileVersion 之外的版本字符串")
  }
  const afterIcon = digestResourceEntries(generatedResources.entries, new Set([3, 14]), true)
  const afterNonVersion = digestResourceEntries(generatedResources.entries, new Set([16]), false)
  if (beforeIcon !== afterIcon || beforeNonVersion !== afterNonVersion) {
    throw new Error("resedit 修改了 icon 或非 VERSION 资源")
  }
  await replaceConcreteExecutable(input.executable, generated)
  return {
    tool: resourceEditorLock,
    iconResources: { beforeSha256: beforeIcon, afterSha256: afterIcon },
    nonVersionResources: { beforeSha256: beforeNonVersion, afterSha256: afterNonVersion },
  }
}

async function authenticateResourceEditor(repositoryRoot: string, moduleFile: string) {
  if (!path.isAbsolute(moduleFile)) throw new Error("resedit module 路径必须是绝对路径")
  const lexicalRoot = path.resolve(repositoryRoot)
  const packageRoots = new Map(
    resourceEditorLock.packages.map((lockedPackage) => [
      lockedPackage.name,
      path.join(
        lexicalRoot,
        "node_modules",
        ".bun",
        `${lockedPackage.name}@${lockedPackage.version}`,
        "node_modules",
        lockedPackage.name,
      ),
    ]),
  )
  const reseditRoot = requirePackageRoot(packageRoots, "resedit")
  const peLibraryRoot = requirePackageRoot(packageRoots, "pe-library")
  const expectedModule = path.join(reseditRoot, ...resourceEditorLock.entry.split("/"))
  if (!samePath(moduleFile, expectedModule) || !isStrictDescendant(lexicalRoot, moduleFile)) {
    throw new Error("resedit module 路径不匹配或逃逸仓库")
  }

  const authenticatedPackages: AuthenticatedResourceEditorPackage[] = []
  for (const lockedPackage of resourceEditorLock.packages) {
    const packageRoot = requirePackageRoot(packageRoots, lockedPackage.name)
    authenticatedPackages.push(await authenticateResourceEditorPackage(lexicalRoot, packageRoot, lockedPackage))
  }

  const junction = path.join(lexicalRoot, ...resourceEditorLock.dependencyJunction.from.split("/"))
  const expectedTarget = path.join(lexicalRoot, ...resourceEditorLock.dependencyJunction.to.split("/"))
  if (!samePath(expectedTarget, peLibraryRoot)) throw new Error("资源编辑器供应链 pe-library 锁定布局无效")
  const junctionStats = await lstat(junction)
  if (!junctionStats.isSymbolicLink()) {
    throw new Error("资源编辑器供应链 pe-library 必须是唯一锁定 junction")
  }
  if (!(await sameCanonicalPath(junction, expectedTarget))) {
    throw new Error("资源编辑器供应链 pe-library junction 目标不匹配")
  }

  await authenticateResourceEditorResolutionGraph(moduleFile, authenticatedPackages, junction, expectedTarget)
  const graphSha256 = digestResourceEditorGraph(authenticatedPackages)
  if (graphSha256 !== resourceEditorLock.graphSha256) {
    throw new Error("资源编辑器供应链实现图 SHA-256 不匹配")
  }
}

type AuthenticatedResourceEditorPackage = Omit<LockedResourceEditorPackage, "files"> & {
  root: string
  files: LockedResourceEditorFile[]
}

async function authenticateResourceEditorPackage(
  repositoryRoot: string,
  packageRoot: string,
  lockedPackage: LockedResourceEditorPackage,
): Promise<AuthenticatedResourceEditorPackage> {
  await assertConcreteDirectory(repositoryRoot, packageRoot)
  const files: LockedResourceEditorFile[] = []
  for (const expected of lockedPackage.files) {
    if (!isCanonicalPackageRelativePath(expected.file)) {
      throw new Error(`资源编辑器供应链 ${lockedPackage.name} 锁定文件路径无效: ${expected.file}`)
    }
    const file = path.join(packageRoot, ...expected.file.split("/"))
    const parent = path.dirname(file)
    if (!samePath(parent, packageRoot)) await assertConcreteDirectory(packageRoot, parent)
    let stats
    try {
      stats = await lstat(file)
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件缺失: ${expected.file}`, { cause: error })
      }
      throw error
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件不是具体普通文件: ${expected.file}`)
    }
    if (!samePath(await realpath(file), path.resolve(file))) {
      throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件 canonical 路径不匹配: ${expected.file}`)
    }
    const bytes = await readFile(file)
    if (stats.size !== expected.size) {
      throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件大小不匹配: ${expected.file}`)
    }
    const digest = sha256(bytes)
    if (digest !== expected.sha256) {
      throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件 ${expected.file} SHA-256 不匹配`)
    }
    files.push({ file: expected.file, size: stats.size, sha256: digest })
  }

  const treeSha256 = digestResourceEditorTree(files)
  if (treeSha256 !== lockedPackage.treeSha256) {
    throw new Error(`资源编辑器供应链 ${lockedPackage.name} 文件树 SHA-256 不匹配`)
  }
  const packageMetadata = requirePackageMetadata(
    JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")),
    lockedPackage.name,
  )
  if (packageMetadata.version !== lockedPackage.version) {
    throw new Error(`资源编辑器供应链 ${lockedPackage.name} package version 不匹配`)
  }
  return { ...lockedPackage, root: packageRoot, files }
}

async function authenticateResourceEditorResolutionGraph(
  moduleFile: string,
  packages: AuthenticatedResourceEditorPackage[],
  dependencyJunction: string,
  dependencyTarget: string,
) {
  const lockedByCanonical = new Map<string, { packageName: string; file: string; absolute: string }>()
  for (const lockedPackage of packages) {
    for (const file of lockedPackage.files.filter((entry) => /\.m?js$/.test(entry.file))) {
      const absolute = path.join(lockedPackage.root, ...file.file.split("/"))
      lockedByCanonical.set(canonicalPathKey(await realpath(absolute)), {
        packageName: lockedPackage.name,
        file: file.file,
        absolute,
      })
    }
  }

  const expectedDependencyEntry = path.join(
    path.dirname(dependencyTarget),
    path.basename(dependencyTarget),
    "dist",
    "index.js",
  )
  const resolvedDependency = createRequire(moduleFile).resolve("pe-library")
  if (!(await sameCanonicalPath(resolvedDependency, expectedDependencyEntry))) {
    throw new Error("资源编辑器供应链 pe-library require 解析目标不匹配")
  }
  const lexicalResolvedFromJunction = path.join(dependencyJunction, "dist", "index.js")
  if (!(await sameCanonicalPath(lexicalResolvedFromJunction, expectedDependencyEntry))) {
    throw new Error("资源编辑器供应链 pe-library junction entry 不匹配")
  }

  const pending = [moduleFile]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const currentKey = canonicalPathKey(await realpath(current))
    if (visited.has(currentKey)) continue
    const locked = lockedByCanonical.get(currentKey)
    if (!locked) throw new Error(`资源编辑器供应链解析到未锁定文件: ${current}`)
    visited.add(currentKey)
    const source = await readFile(locked.absolute, "utf8")
    for (const request of extractStaticModuleRequests(source)) {
      if (isBuiltin(request)) continue
      let resolved: string
      try {
        resolved = createRequire(locked.absolute).resolve(request)
      } catch (error) {
        throw new Error(`资源编辑器供应链无法解析 ${locked.packageName}/${locked.file} -> ${request}`, {
          cause: error,
        })
      }
      const resolvedKey = canonicalPathKey(await realpath(resolved))
      if (!lockedByCanonical.has(resolvedKey)) {
        throw new Error(`资源编辑器供应链解析到图外依赖: ${locked.packageName}/${locked.file} -> ${request}`)
      }
      pending.push(resolved)
    }
  }
  if (visited.size !== lockedByCanonical.size || [...lockedByCanonical.keys()].some((file) => !visited.has(file))) {
    throw new Error(`资源编辑器供应链实际解析图不完整: expected=${lockedByCanonical.size}, actual=${visited.size}`)
  }
}

function extractStaticModuleRequests(source: string) {
  const requests = new Set<string>()
  for (const pattern of [
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) requests.add(match[1])
    }
  }
  return [...requests]
}

function digestResourceEditorTree(files: readonly LockedResourceEditorFile[]) {
  return sha256(files.map((file) => `${file.file}\0${file.size}\0${file.sha256}`).join("\n") + "\n")
}

function digestResourceEditorGraph(packages: AuthenticatedResourceEditorPackage[]) {
  return sha256(
    JSON.stringify({
      packages: packages.map(({ root: _root, ...lockedPackage }) => lockedPackage),
      dependencyJunction: resourceEditorLock.dependencyJunction,
    }) + "\n",
  )
}

function requirePackageRoot(packageRoots: Map<string, string>, name: string) {
  const packageRoot = packageRoots.get(name)
  if (!packageRoot) throw new Error(`资源编辑器供应链缺少锁定 package: ${name}`)
  return packageRoot
}

function requirePackageMetadata(input: unknown, packageName: string) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("name" in input) ||
    input.name !== packageName ||
    !("version" in input) ||
    typeof input.version !== "string"
  ) {
    throw new Error(`资源编辑器供应链 ${packageName} package name/version 不匹配`)
  }
  return { version: input.version }
}

function isCanonicalPackageRelativePath(file: string) {
  return (
    file.length > 0 &&
    !file.includes("\\") &&
    !path.posix.isAbsolute(file) &&
    path.posix.normalize(file) === file &&
    file.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  )
}

function canonicalPathKey(file: string) {
  return path.resolve(file).toLowerCase()
}

type ResourceEntry = {
  type: string | number
  id: string | number
  lang: string | number
  codepage: number
  bin: ArrayBuffer
}

type VersionInfo = {
  getAllLanguagesForStringValues(): Array<{ lang: number; codepage: number }>
  getStringValues(language: { lang: number; codepage: number }): Record<string, string>
  outputToResourceEntries(entries: ResourceEntry[]): void
  setFileVersion(version: string): void
  setProductVersion(version: string): void
  setStringValues(language: { lang: number; codepage: number }, values: Record<string, string>): void
}

type ReseditModule = {
  NtExecutable: { from(input: Uint8Array): { generate(): ArrayBuffer } }
  NtExecutableResource: {
    from(executable: { generate(): ArrayBuffer }): {
      entries: ResourceEntry[]
      outputResource(executable: { generate(): ArrayBuffer }): void
    }
  }
  Resource: { VersionInfo: { fromEntries(entries: ResourceEntry[]): VersionInfo[] } }
}

function requireResedit(input: unknown): ReseditModule {
  if (!isReseditModule(input)) throw new Error("resedit module API 无效")
  return input
}

function isReseditModule(input: unknown): input is ReseditModule {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const ntExecutable = "NtExecutable" in input ? input.NtExecutable : undefined
  const ntExecutableResource = "NtExecutableResource" in input ? input.NtExecutableResource : undefined
  const resource = "Resource" in input ? input.Resource : undefined
  return (
    typeof ntExecutable === "function" &&
    "from" in ntExecutable &&
    typeof ntExecutable.from === "function" &&
    typeof ntExecutableResource === "function" &&
    "from" in ntExecutableResource &&
    typeof ntExecutableResource.from === "function" &&
    !!resource &&
    typeof resource === "object" &&
    "VersionInfo" in resource &&
    typeof resource.VersionInfo === "function" &&
    "fromEntries" in resource.VersionInfo &&
    typeof resource.VersionInfo.fromEntries === "function"
  )
}

function digestResourceEntries(entries: ResourceEntry[], types: Set<number>, include: boolean) {
  const selected = entries.filter((entry) => {
    const matches = typeof entry.type === "number" && types.has(entry.type)
    return include ? matches : !matches
  })
  if (include && (!selected.some((entry) => entry.type === 3) || !selected.some((entry) => entry.type === 14))) {
    throw new Error("resedit 目标缺少 RT_ICON 或 RT_GROUP_ICON")
  }
  const records = selected
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      lang: entry.lang,
      codepage: entry.codepage,
      size: entry.bin.byteLength,
      sha256: sha256(Buffer.from(entry.bin)),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return sha256(JSON.stringify(records))
}

function omitMutableVersionStrings(strings: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(strings)
      .filter(([key]) => key !== "FileVersion" && key !== "ProductVersion")
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

async function replaceConcreteExecutable(executable: string, content: Uint8Array) {
  const stats = await lstat(executable)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("resedit 目标必须是具体普通 EXE")
  const temporary = path.join(
    path.dirname(executable),
    `.${path.basename(executable)}.resedit-${process.pid}-${crypto.randomUUID()}`,
  )
  const handle = await open(temporary, "wx")
  try {
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const temporaryStats = await lstat(temporary)
    if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile() || temporaryStats.size !== content.byteLength) {
      throw new Error("resedit 临时 EXE 不是预期具体普通文件")
    }
    await rename(temporary, executable)
  } catch (error) {
    await removeConcreteTemporary(temporary)
    throw error
  }
}

async function removeConcreteTemporary(file: string) {
  try {
    const stats = await lstat(file)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("拒绝清理被替换的 resedit 临时路径")
    await unlink(file)
  } catch (error) {
    if (isErrno(error, "ENOENT")) return
    throw error
  }
}

async function requireConcreteExecutable(root: string, executable: string) {
  const stats = await lstat(executable)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("品牌 EXE 必须是具体普通文件")
  if (
    !isStrictDescendant(root, executable) ||
    !(await sameCanonicalPath(executable, path.join(root, path.basename(executable))))
  ) {
    throw new Error("品牌 EXE canonical 路径逃逸")
  }
}

function requirePeMetadata(input: unknown, label: string): WindowsPeMetadata {
  if (!isWindowsPeMetadata(input)) throw new Error(`${label} PE 元数据无效`)
  return { ...input }
}

function requireExactMetadata(actual: WindowsPeMetadata, expected: WindowsPeMetadata, label: string) {
  for (const key of [
    "productName",
    "productVersion",
    "fileVersion",
    "numericFileVersion",
    "numericProductVersion",
    "signatureStatus",
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${label} PE ${key} 不匹配: actual=${actual[key]} expected=${expected[key]}`)
    }
  }
}

function isWindowsPeMetadata(input: unknown): input is WindowsPeMetadata {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    "productName" in input &&
    typeof input.productName === "string" &&
    "productVersion" in input &&
    typeof input.productVersion === "string" &&
    "fileVersion" in input &&
    typeof input.fileVersion === "string" &&
    "numericFileVersion" in input &&
    typeof input.numericFileVersion === "string" &&
    "numericProductVersion" in input &&
    typeof input.numericProductVersion === "string" &&
    "signatureStatus" in input &&
    typeof input.signatureStatus === "string"
  )
}

function requireEditEvidence(input: unknown): VersionResourceEditEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("resedit 资源证据无效")
  if (!("tool" in input) || JSON.stringify(input.tool) !== JSON.stringify(resourceEditorLock)) {
    throw new Error("resedit 锁定工具证据无效")
  }
  return {
    tool: resourceEditorLock,
    iconResources: requireDigestPair("iconResources" in input ? input.iconResources : undefined, "icon"),
    nonVersionResources: requireDigestPair(
      "nonVersionResources" in input ? input.nonVersionResources : undefined,
      "非 VERSION 资源",
    ),
  }
}

function requireDigestPair(input: unknown, label: string) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !("beforeSha256" in input) ||
    typeof input.beforeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.beforeSha256) ||
    !("afterSha256" in input) ||
    typeof input.afterSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.afterSha256)
  ) {
    throw new Error(`resedit ${label}摘要无效`)
  }
  return { beforeSha256: input.beforeSha256, afterSha256: input.afterSha256 }
}

function requireBaseVersion(version: string) {
  const match = /^(\d+\.\d+\.\d+)-/.exec(version)
  if (!match) throw new Error("品牌 PE 完整版本缺少基础版本")
  return match[1]
}

function samePath(left: string, right: string) {
  return path.relative(path.resolve(left), path.resolve(right)) === ""
}

async function sameCanonicalPath(left: string, right: string) {
  return samePath(await realpath(left), await realpath(right))
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

export function deriveWindowsVersion(identity: BuildIdentity) {
  requireIdentity(identity)
  if (identity.channel === "dev") return "0.0.0.0"
  const match = /^\d+\.\d+\.\d+-(\d{2})(\d{2})(\d{2})-(\d{2})-[a-f0-9]{10}$/.exec(identity.version)
  if (!match) throw new Error("prod 完整版本无法派生 Windows 数字版本")
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0 || part > 65_535)) {
    throw new Error("Windows 数字版本分段必须位于 0..65535")
  }
  return parts.join(".")
}

function requireBuilderContext(context: BuilderContext) {
  if (context.platform !== "win32") throw new Error("BluedCode 目录包仅支持 Windows")
  if (context.arch !== "x64") throw new Error("BluedCode 目录包仅支持 Windows x64")
  if (typeof context.afterSign !== "function") throw new Error("BluedCode 目录包 afterSign 钩子无效")
  requireIdentity(context.identity)
  if (!/^\d+\.\d+\.\d+$/.test(context.electronVersion)) throw new Error("Electron 版本无效")
  const assetRoot = path.dirname(context.assets.iconIco)
  if (
    ![context.assets.faviconPng, context.assets.faviconSvg, context.assets.wordmarkSvg].every(
      (file) => path.dirname(file) === assetRoot,
    ) ||
    !isStrictDescendant(path.join(context.paths.stageDir, "assets"), assetRoot)
  ) {
    throw new Error("Task 5 派生资源必须位于同一隔离摘要目录")
  }
  if (!path.isAbsolute(context.nativePackageDir)) throw new Error("原生运行依赖路径必须是绝对路径")
}

function requireIdentity(identity: BuildIdentity) {
  if (identity.channel !== "dev" && identity.channel !== "prod") throw new Error("channel 只能是 dev 或 prod")
  if (!/^[a-f0-9]{40}$/.test(identity.commit) || identity.shortCommit !== identity.commit.slice(0, 10)) {
    throw new Error("构建身份 commit 无效")
  }
  if (identity.channel === "dev") {
    if (identity.name !== "BluedCode Dev" || identity.appId !== "ai.bluedcode.desktop.dev") {
      throw new Error("dev 构建身份无效")
    }
    if (identity.protocol !== "bluedcode-dev" || identity.tag !== undefined) throw new Error("dev 协议或 tag 无效")
    if (identity.version !== `1.18.18-dev-${identity.shortCommit}`) throw new Error("dev 完整版本无效")
    return
  }
  if (identity.name !== "BluedCode" || identity.appId !== "ai.bluedcode.desktop") {
    throw new Error("prod 构建身份无效")
  }
  if (identity.protocol !== "bluedcode" || identity.tag !== `bluedcode-v${identity.version.slice(0, 17)}`) {
    throw new Error("prod 协议或 tag 无效")
  }
}

function isStrictDescendant(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
