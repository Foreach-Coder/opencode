import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rename } from "node:fs/promises"
import path from "node:path"
import { Product } from "../../../../packages/product/src"
import type { AuditReport } from "./audit"
import type { GitSourceState } from "./config"
import type { DistributionZipAudit } from "./distribution-zip"
import {
  assertConcreteDirectory,
  assertSafeDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  publishImmutableFile,
  removeSafeDirectory,
  verifyConcreteFile,
} from "./isolation"
import type { BuildPaths } from "./paths"
import type { BuildIdentity } from "./types"
import type { UnifiedLedger } from "./ledger"
import type { RuntimeAcceptanceEvidence } from "./runtime-acceptance"

const smartScreenWarning = "Windows SmartScreen 可能显示“未知发布者”" as const

export type PackageAudit = {
  asarFiles: string[]
  unpackedFiles: string[]
  nativeExecutables: string[]
  bannedEntrypoints: string[]
  passed: boolean
}

export type PeAudit = {
  productName: string
  productVersion: string
  fileVersion: string
  numericFileVersion: string
  numericProductVersion: string
  signatureStatus: "NotSigned"
  passed: boolean
}

type ResourcePeMetadata = Omit<PeAudit, "passed" | "signatureStatus"> & { signatureStatus: string }

export type ResourceEditAudit = {
  target: string
  tool: unknown
  before: ResourcePeMetadata
  after: ResourcePeMetadata
  iconResources: { beforeSha256: string; afterSha256: string }
  nonVersionResources: { beforeSha256: string; afterSha256: string }
  passed: true
}

export type EnterprisePolicy = {
  enabled: boolean
  providerMode: "admin-static-only" | "disabled"
  blockedAuthWrites: boolean
  blockedPublicShare: boolean
  blockedPublicCatalogRefresh: boolean
  blockedTelemetry: boolean
  blockedPublicUpdates: boolean
  blockedPublicProductLinks: boolean
}

export type ReleaseManifest = {
  schemaVersion: 1
  product: {
    name: BuildIdentity["name"]
    appId: BuildIdentity["appId"]
    protocol: BuildIdentity["protocol"]
    channel: BuildIdentity["channel"]
    platform: "win32"
    arch: "x64"
  }
  baseline: {
    tag: string
    commit: string
    desktopVersion: string
  }
  build: {
    version: string
    commit: string
    shortCommit: string
    builtAtUtc: string
    tools: {
      bun: string
      electron: string
      electronBuilder: string
      appBuilderLib: string
      electronVite: string
      resedit: string
    }
    source: { before: GitSourceState; after: GitSourceState }
    digests: { framework: string; adapter: string; assets: string }
    cache: { server: boolean; electronVite: boolean; distributionZip: false }
  }
  release: { targetTag: string | null; annotatedTagCommand: string | null }
  artifact: {
    file: string
    format: "windows-zip"
    size: number
    sha256: string
    unsigned: true
    smartScreen: typeof smartScreenWarning
  }
  transformation: { ledger: UnifiedLedger; sha256: string }
  enterprise: { policy: EnterprisePolicy; audit: AuditReport }
  audit: {
    output: AuditReport
    package: PackageAudit
    pe: PeAudit
    distributionZip: DistributionZipAudit & {
      applicationPe: PeAudit
      nativeExecutableSignatures: Array<{ file: string; signatureStatus: string }>
      resourceEdit: ResourceEditAudit
    }
    runtime: RuntimeAcceptanceEvidence
    releaseDirectory: { files: string[]; passed: true }
  }
}

export type ReleaseManifestInput = {
  identity: BuildIdentity
  baseline: { tag: string; commit: string; desktopVersion: string }
  resourceEditorTool: unknown
  builtAtUtc: string
  tools: ReleaseManifest["build"]["tools"]
  source: ReleaseManifest["build"]["source"]
  digests: ReleaseManifest["build"]["digests"]
  cache: ReleaseManifest["build"]["cache"]
  release: ReleaseManifest["release"]
  artifact: { size: number; sha256: string }
  transformation: ReleaseManifest["transformation"]
  enterprise: { audit: AuditReport }
  audit: Omit<ReleaseManifest["audit"], "releaseDirectory">
}

export function createReleaseManifest(input: ReleaseManifestInput): ReleaseManifest {
  validateManifestInput(input)
  return {
    schemaVersion: 1,
    product: {
      name: input.identity.name,
      appId: input.identity.appId,
      protocol: input.identity.protocol,
      channel: input.identity.channel,
      platform: "win32",
      arch: "x64",
    },
    baseline: { ...input.baseline },
    build: {
      version: input.identity.version,
      commit: input.identity.commit,
      shortCommit: input.identity.shortCommit,
      builtAtUtc: input.builtAtUtc,
      source: {
        before: { ...input.source.before },
        after: { ...input.source.after },
      },
      tools: { ...input.tools },
      digests: { ...input.digests },
      cache: { ...input.cache },
    },
    release: { ...input.release },
    artifact: {
      file: input.identity.artifactName,
      format: "windows-zip",
      size: input.artifact.size,
      sha256: input.artifact.sha256,
      unsigned: true,
      smartScreen: smartScreenWarning,
    },
    transformation: input.transformation,
    enterprise: {
      policy: enterprisePolicyFromProfile(Product.profile.operations),
      audit: input.enterprise.audit,
    },
    audit: {
      ...input.audit,
      releaseDirectory: {
        files: [input.identity.artifactName, "release-manifest.json"].sort((left, right) => left.localeCompare(right)),
        passed: true,
      },
    },
  }
}

export function enterprisePolicyFromProfile(operations: typeof Product.profile.operations): EnterprisePolicy {
  return {
    enabled: operations["provider.read"] === "allow-admin-static",
    providerMode: operations["provider.read"] === "allow-admin-static" ? "admin-static-only" : "disabled",
    blockedAuthWrites: operations["auth.manage"] === "deny",
    blockedPublicShare: operations["share.public"] === "deny",
    blockedPublicCatalogRefresh: operations["catalog.public"] === "deny",
    blockedTelemetry: operations.telemetry === "deny",
    blockedPublicUpdates: operations["update.public"] === "deny",
    blockedPublicProductLinks: operations["proxy.public"] === "deny",
  }
}

export function serializeReleaseManifest(manifest: ReleaseManifest) {
  validateReleaseManifest(manifest)
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export async function digestBuildInputs(paths: Pick<BuildPaths, "frameworkRoot" | "versionRoot">) {
  return {
    framework: await digestTree(path.join(paths.frameworkRoot, "common")),
    adapter: await digestTree(paths.versionRoot, new Set(["tests"])),
  }
}

export async function publishRelease(input: {
  artifactsRoot: string
  artifactFile: string
  manifest: ReleaseManifest
  outputRoot: string
  repositoryRoot: string
}) {
  const manifestContent = serializeReleaseManifest(input.manifest)
  const artifactDigest = input.manifest.artifact.sha256
  const manifestDigest = sha256(manifestContent)
  const directoryDigest = sha256(`${artifactDigest}\0${manifestDigest}`)
  const isolation = await prepareIsolation({ repositoryRoot: input.repositoryRoot, outputRoot: input.outputRoot })
  await assertSafeDirectory(isolation, input.outputRoot)
  await assertConcreteDirectory(input.repositoryRoot, input.outputRoot)
  await verifyConcreteFile(input.outputRoot, input.artifactFile, artifactDigest)
  const artifactStats = await lstat(input.artifactFile)
  if (artifactStats.size !== input.manifest.artifact.size) throw new Error("zip 产物大小与 manifest 不匹配")
  requireArtifactName(input.manifest.artifact.file)
  requireStrictDescendant(input.outputRoot, input.artifactsRoot)
  await ensureSafeDirectory(isolation, input.artifactsRoot)
  await assertConcreteDirectory(input.outputRoot, input.artifactsRoot)

  const target = path.join(input.artifactsRoot, directoryDigest)
  if (await exists(target)) {
    await verifyPublishedRelease(target, input.manifest, manifestDigest)
    return releasePaths(target, input.manifest.artifact.file)
  }

  const temporary = path.join(input.artifactsRoot, `.tmp-${directoryDigest}-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, temporary)
  await assertConcreteDirectory(input.artifactsRoot, temporary)
  try {
    await Promise.all([
      publishImmutableFile(
        isolation,
        temporary,
        path.join(temporary, input.manifest.artifact.file),
        await readFile(input.artifactFile),
        artifactDigest,
      ),
      publishImmutableFile(
        isolation,
        temporary,
        path.join(temporary, "release-manifest.json"),
        manifestContent,
        manifestDigest,
      ),
    ])
    await verifyPublishedRelease(temporary, input.manifest, manifestDigest)
    try {
      await rename(temporary, target)
    } catch (error) {
      if (!(await exists(target))) throw error
      await verifyPublishedRelease(target, input.manifest, manifestDigest)
      await removeSafeDirectory(isolation, temporary)
    }
    await verifyPublishedRelease(target, input.manifest, manifestDigest)
    return releasePaths(target, input.manifest.artifact.file)
  } catch (error) {
    if (await exists(temporary)) await removeSafeDirectory(isolation, temporary)
    throw error
  }
}

function validateManifestInput(input: ReleaseManifestInput) {
  if (!/^v\d+\.\d+\.\d+$/.test(input.baseline.tag)) throw new Error("manifest baseline tag 无效")
  if (!/^[a-f0-9]{40}$/.test(input.baseline.commit)) throw new Error("manifest baseline commit 无效")
  if (!/^\d+\.\d+\.\d+$/.test(input.baseline.desktopVersion)) throw new Error("manifest baseline version 无效")
  if (new Date(input.builtAtUtc).toISOString() !== input.builtAtUtc) throw new Error("manifest 构建时间必须是 UTC ISO")
  validateSource(input.source.before, "before")
  validateSource(input.source.after, "after")
  if (input.source.before.head !== input.identity.commit || input.source.after.head !== input.identity.commit) {
    throw new Error("manifest Git source HEAD 与构建身份 commit 不一致")
  }
  if (
    input.source.before.head !== input.source.after.head ||
    input.source.before.branch !== input.source.after.branch ||
    input.source.before.trackedIndexSha256 !== input.source.after.trackedIndexSha256 ||
    input.source.before.trackedContentSha256 !== input.source.after.trackedContentSha256
  ) {
    throw new Error("manifest Git source before/after 必须完全一致")
  }
  for (const [name, digest] of Object.entries(input.digests)) requireDigest(digest, `manifest ${name} digest`)
  requireDigest(input.artifact.sha256, "manifest artifact digest")
  requireDigest(input.transformation.sha256, "manifest transform ledger digest")
  if (!Number.isSafeInteger(input.artifact.size) || input.artifact.size <= 0)
    throw new Error("manifest artifact size 无效")
  if (
    !input.enterprise.audit.passed ||
    !input.audit.output.passed ||
    !input.audit.package.passed ||
    !input.audit.pe.passed ||
    !input.audit.distributionZip.passed
  ) {
    throw new Error("manifest 不得记录未通过的审计")
  }
  if (input.audit.pe.signatureStatus !== "NotSigned") throw new Error("品牌应用 EXE 必须 unsigned")
  const distributionZipCache: unknown = Reflect.get(input.cache, "distributionZip")
  if (
    JSON.stringify(Object.keys(input.cache).sort()) !== JSON.stringify(["distributionZip", "electronVite", "server"]) ||
    typeof input.cache.server !== "boolean" ||
    typeof input.cache.electronVite !== "boolean" ||
    typeof distributionZipCache !== "boolean" ||
    distributionZipCache
  ) {
    throw new Error("manifest cache exact schema 或 zip 目录包缓存语义无效")
  }
  if (
    input.tools.electronBuilder !== "26.15.2" ||
    input.tools.appBuilderLib !== "26.15.2" ||
    input.tools.resedit !== "1.7.2" ||
    input.audit.distributionZip.topLevelDirectory !== input.identity.artifactDirectoryName ||
    input.audit.distributionZip.sourceTree.files !== input.audit.distributionZip.zipTree.files ||
    input.audit.distributionZip.sourceTree.sha256 !== input.audit.distributionZip.zipTree.sha256
  ) {
    throw new Error("manifest 最终 zip 目录包审计无效")
  }
  validateRuntimeAcceptance(input.audit.runtime, input.identity)
  requireDigest(input.audit.distributionZip.sourceTree.sha256, "manifest source payload tree digest")
  requireDigest(input.audit.distributionZip.zipTree.sha256, "manifest zip payload tree digest")
  if (
    !Number.isSafeInteger(input.audit.distributionZip.sourceTree.files) ||
    input.audit.distributionZip.sourceTree.files <= 0 ||
    !Number.isSafeInteger(input.audit.distributionZip.zipTree.files) ||
    input.audit.distributionZip.zipTree.files <= 0
  ) {
    throw new Error("manifest zip payload tree 文件数无效")
  }
  if (
    !input.audit.distributionZip.applicationPe.passed ||
    input.audit.distributionZip.applicationPe.signatureStatus !== "NotSigned"
  ) {
    throw new Error("最终 zip 内品牌应用 EXE 必须通过 unsigned 审计")
  }
  validateResourceEditAudit(
    input.audit.distributionZip.resourceEdit,
    input.audit.distributionZip.applicationPe,
    input.identity.name,
    input.resourceEditorTool,
  )
  if (
    input.audit.distributionZip.nativeExecutableSignatures.length !== 1 ||
    input.audit.distributionZip.nativeExecutableSignatures[0]?.file !==
      "resources/app.asar.unpacked/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe" ||
    input.audit.distributionZip.nativeExecutableSignatures[0]?.signatureStatus !== "Valid"
  ) {
    throw new Error("manifest 最终 zip 原生 EXE 签名审计无效")
  }
  if (input.identity.channel === "dev" && (input.release.targetTag || input.release.annotatedTagCommand)) {
    throw new Error("dev manifest 不得包含发行 tag")
  }
  if (input.identity.channel === "prod" && (!input.release.targetTag || !input.release.annotatedTagCommand)) {
    throw new Error("prod manifest 必须包含 tag 候选与中文命令")
  }
}

function validateRuntimeAcceptance(runtime: RuntimeAcceptanceEvidence, identity: BuildIdentity) {
  assertNoRuntimeSecrets(runtime, "runtime")
  assertExactKeys(
    runtime,
    [
      "adminConfig",
      "checks",
      "configDirectory",
      "executableStarted",
      "exitedCleanly",
      "lingeringProcesses",
      "logs",
      "mode",
      "preloadReady",
      "publicNetworkCalls",
      "rendererReady",
      "serverHealthReady",
      "adminModelLoaded",
      "visibleVersion",
    ],
    "runtime",
  )
  assertExactKeys(runtime.adminConfig, ["apiKeySha256", "modelId", "providerId"], "runtime.adminConfig")
  assertExactKeys(
    runtime.checks,
    ["deepLinkRefresh", "defaultSessionCore", "disabledEntrypoints", "sessionCoreSwitchesTo", "staleSession"],
    "runtime.checks",
  )
  assertExactKeys(runtime.checks.deepLinkRefresh, ["moved", "refreshed"], "runtime.checks.deepLinkRefresh")
  assertExactKeys(runtime.checks.staleSession, ["appShellLoaded", "recoveryError"], "runtime.checks.staleSession")
  assertExactKeys(
    runtime.checks.staleSession.recoveryError,
    ["code", "message"],
    "runtime.checks.staleSession.recoveryError",
  )
  assertExactKeys(runtime.logs, ["stderrSha256", "stdoutSha256"], "runtime.logs")
  if (
    !runtime ||
    runtime.mode !== "windows-zip" ||
    runtime.configDirectory !== ".config/bluedcode" ||
    runtime.visibleVersion !== identity.version
  ) {
    throw new Error("manifest runtime zip 目录包身份证据无效")
  }
  if (
    runtime.executableStarted !== true ||
    runtime.serverHealthReady !== true ||
    runtime.preloadReady !== true ||
    runtime.rendererReady !== true ||
    runtime.adminModelLoaded !== true ||
    runtime.exitedCleanly !== true ||
    !Array.isArray(runtime.lingeringProcesses) ||
    runtime.lingeringProcesses.length !== 0 ||
    !Array.isArray(runtime.publicNetworkCalls) ||
    runtime.publicNetworkCalls.length !== 0 ||
    "mainProcessError" in runtime ||
    runtime.checks?.defaultSessionCore !== "v1" ||
    runtime.checks.sessionCoreSwitchesTo !== "v2" ||
    runtime.checks.deepLinkRefresh?.moved !== true ||
    runtime.checks.deepLinkRefresh?.refreshed !== true ||
    JSON.stringify(runtime.checks.disabledEntrypoints) !==
      JSON.stringify(["auth", "connect-provider", "share", "update"]) ||
    runtime.checks.staleSession?.appShellLoaded !== true ||
    runtime.checks.staleSession.recoveryError?.code !== "SESSION_NOT_FOUND" ||
    runtime.checks.staleSession.recoveryError.message !== "Session not found: stale-session"
  ) {
    throw new Error("manifest runtime zip 目录包主进程、Profile 或企业策略证据无效")
  }
  if (
    runtime.adminConfig?.providerId !== "openai-proxy" ||
    runtime.adminConfig.modelId !== "gpt-4.1" ||
    !/^[a-f0-9]{64}$/.test(runtime.adminConfig.apiKeySha256)
  ) {
    throw new Error("manifest runtime zip 目录包管理员模型证据无效")
  }
  if (JSON.stringify(runtime).includes("sk-runtime-acceptance-secret") || "apiKey" in runtime.adminConfig) {
    throw new Error("manifest runtime 不得包含明文 secret 密钥")
  }
  if (!/^[a-f0-9]{64}$/.test(runtime.logs?.stdoutSha256) || !/^[a-f0-9]{64}$/.test(runtime.logs.stderrSha256)) {
    throw new Error("manifest runtime zip 目录包日志摘要无效")
  }
}

function assertExactKeys(value: unknown, expected: readonly string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`manifest ${label} schema 无效`)
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right))
  const sortedExpected = [...expected].sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) throw new Error(`manifest ${label} schema 无效`)
}

function assertNoRuntimeSecrets(value: unknown, label: string) {
  if (typeof value === "string") {
    if (/(?:sk-[A-Za-z0-9_-]{8,}|secret|password|api[_-]?key|token)/i.test(value)) {
      throw new Error(`manifest ${label} 不得包含明文 secret 密钥`)
    }
    return
  }
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRuntimeSecrets(item, `${label}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "apiKeySha256" && /(?:secret|password|api[_-]?key|token)/i.test(key)) {
      throw new Error(`manifest ${label}.${key} 不得包含明文 secret 密钥`)
    }
    assertNoRuntimeSecrets(child, `${label}.${key}`)
  }
}

function validateSource(source: GitSourceState, label: string) {
  if (!/^[a-f0-9]{40}$/.test(source.head)) throw new Error(`manifest source ${label} HEAD 无效`)
  if (!source.branch || source.branch === "HEAD" || /[\0\r\n]/.test(source.branch)) {
    throw new Error(`manifest source ${label} branch 无效`)
  }
  requireDigest(source.trackedIndexSha256, `manifest source ${label} tracked index digest`)
  requireDigest(source.trackedContentSha256, `manifest source ${label} tracked content digest`)
}

function validateResourceEditAudit(
  resourceEdit: ResourceEditAudit,
  applicationPe: PeAudit,
  productName: string,
  resourceEditorTool: unknown,
) {
  if (
    !resourceEdit ||
    !isTrue(Reflect.get(resourceEdit, "passed")) ||
    resourceEdit.target !== `win-unpacked/${productName}.exe` ||
    !resourceEdit.tool ||
    typeof resourceEdit.tool !== "object" ||
    JSON.stringify(resourceEdit.tool) !== JSON.stringify(resourceEditorTool)
  ) {
    throw new Error("manifest 品牌应用 PE 资源编辑工具或目标无效")
  }
  if (resourceEdit.before.productName !== productName || resourceEdit.before.signatureStatus !== "NotSigned") {
    throw new Error("manifest 品牌应用 PE 资源编辑前元数据无效")
  }
  const after = resourceEdit.after
  if (
    after.productName !== applicationPe.productName ||
    after.productVersion !== applicationPe.productVersion ||
    after.fileVersion !== applicationPe.fileVersion ||
    after.numericFileVersion !== applicationPe.numericFileVersion ||
    after.numericProductVersion !== applicationPe.numericProductVersion ||
    after.signatureStatus !== applicationPe.signatureStatus
  ) {
    throw new Error("manifest 品牌应用 PE 资源编辑后元数据与最终载荷不一致")
  }
  for (const evidence of [resourceEdit.iconResources, resourceEdit.nonVersionResources]) {
    requireDigest(evidence.beforeSha256, "manifest PE 资源编辑前摘要")
    requireDigest(evidence.afterSha256, "manifest PE 资源编辑后摘要")
    if (evidence.beforeSha256 !== evidence.afterSha256) {
      throw new Error("manifest PE 资源编辑不得改变 icon 或非 VERSION 资源")
    }
  }
}

function isTrue(value: unknown): value is true {
  return value === true
}

function validateReleaseManifest(manifest: ReleaseManifest) {
  if (
    Object.keys(manifest).sort().join(",") !==
    "artifact,audit,baseline,build,enterprise,product,release,schemaVersion,transformation"
  ) {
    throw new Error("release manifest 顶层 schema 无效")
  }
  if (manifest.schemaVersion !== 1) throw new Error("release manifest schemaVersion 无效")
  if (
    JSON.stringify(manifest.enterprise.policy) !==
    JSON.stringify(enterprisePolicyFromProfile(Product.profile.operations))
  ) {
    throw new Error("release manifest 企业策略必须由产品 Profile 派生")
  }
  if (!manifest.artifact.unsigned || manifest.artifact.smartScreen !== smartScreenWarning) {
    throw new Error("release manifest 必须声明 unsigned SmartScreen 限制")
  }
  requireArtifactName(manifest.artifact.file)
  requireDigest(manifest.artifact.sha256, "release manifest artifact digest")
  validateRuntimeAcceptance(manifest.audit.runtime, {
    channel: manifest.product.channel,
    name: manifest.product.name,
    appId: manifest.product.appId,
    protocol: manifest.product.protocol,
    version: manifest.build.version,
    commit: manifest.build.commit,
    shortCommit: manifest.build.shortCommit,
    artifactDirectoryName: manifest.artifact.file.replace(/-windows-x64\.zip$/, ""),
    artifactName: manifest.artifact.file,
    ...(manifest.release.targetTag ? { tag: manifest.release.targetTag } : {}),
  })
}

async function verifyPublishedRelease(directory: string, manifest: ReleaseManifest, manifestDigest: string) {
  const expected = [manifest.artifact.file, "release-manifest.json"].sort((left, right) => left.localeCompare(right))
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new Error(`release 目录文件集合无效: ${names.join(", ")}`)
  }
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile())) {
    throw new Error("release 目录只允许两个具体普通文件")
  }
  await Promise.all([
    verifyConcreteFile(directory, path.join(directory, manifest.artifact.file), manifest.artifact.sha256),
    verifyConcreteFile(directory, path.join(directory, "release-manifest.json"), manifestDigest),
  ])
}

function releasePaths(directory: string, artifactName: string) {
  return {
    directory,
    artifact: path.join(directory, artifactName),
    manifest: path.join(directory, "release-manifest.json"),
  }
}

async function digestTree(root: string, ignoredDirectories = new Set<string>()) {
  const files: string[] = []
  await visit(root, "")
  const hash = createHash("sha256")
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(path.join(root, ...file.split("/"))))
      .update("\0")
  }
  return hash.digest("hex")

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`构建摘要拒绝符号链接: ${childRelative}`)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path.join(directory, entry.name), childRelative)
        continue
      }
      if (!entry.isFile()) throw new Error(`构建摘要拒绝非普通文件: ${childRelative}`)
      files.push(childRelative)
    }
  }
}

function requireArtifactName(value: string) {
  if (!/^BluedCode(?:-Dev)?-[A-Za-z0-9.-]+-windows-x64\.zip$/.test(value) || path.basename(value) !== value) {
    throw new Error("zip artifactName 无效")
  }
}

function requireDigest(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} 必须是小写 SHA-256`)
}

function requireStrictDescendant(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`release 路径越界: ${target}`)
  }
}

async function exists(target: string) {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}
