import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { isBuiltin } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { scanOutput, type AuditAllowance, type AuditPolicy } from "./common/audit"
import { deriveDesktopAssets, validateBrandAssets, type DerivedAssets } from "./common/assets"
import {
  assertTrackedBaseline,
  captureGitSourceState,
  parseBuildArgs,
  resolveBuildIdentity,
  withCertifiedGitSource,
} from "./common/config"
import { createGit, type Git } from "./common/git"
import { collectConfiguredSecrets, readFailureContext, writeFailureReport, type FailureStage } from "./common/failure"
import { createDistributionZip, extractDistributionZip } from "./common/distribution-zip"
import { validateLedger, type UnifiedLedger } from "./common/ledger"
import {
  assertConcreteDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  publishImmutableFile,
  removeSafeDirectory,
  verifyConcreteFile,
} from "./common/isolation"
import { createBuildPaths } from "./common/paths"
import { createReleaseManifest, digestBuildInputs, publishRelease, type PeAudit } from "./common/manifest"
import { createAnnotatedTagCommand, refreshReleaseLedger } from "./common/release"
import { createRuntimeAcceptanceEvidence, writeRuntimePortableConfig } from "./common/runtime-acceptance"
import { buildServer, type ServerBundle } from "./common/server"
import { verifySnapshot as verifyFrameworkSnapshot } from "./common/snapshot"
import { selectVersionAdapter } from "./common/adapter-registry"
import type { VersionAdapter } from "./common/adapter"
import type { BuildIdentity, SnapshotManifest } from "./common/types"
import { baseline } from "./version/1.18.18/baseline"
import "./version/1.18.18"
import {
  createBrandedExecutableVersionHook,
  createBuilderConfig,
  createReseditVersionOperations,
  deriveWindowsVersion,
  nativeRuntimeFiles,
} from "./version/1.18.18/electron-builder"

export type PreflightOptions = {
  git?: Git
  repositoryRoot?: string
  verifySnapshot?: (root: string) => Promise<SnapshotManifest>
}

export type NativeRuntimeManifest = {
  version: 1
  packageName: "@lydell/node-pty-win32-x64"
  packageVersion: "1.2.0-beta.12"
  files: Array<{ file: string; size: number; sha256: string }>
}

export type AsarExpectedFile = string | { file: string; size: number; sha256: string }

export async function preflightBuild(argv: string[], options: PreflightOptions = {}) {
  const request = parseBuildArgs(argv)
  const repositoryRoot = path.resolve(options.repositoryRoot ?? path.resolve(import.meta.dir, "../../.."))
  const git = options.git ?? createGit(repositoryRoot)
  const releaseTags = request.channel === "prod" ? await refreshReleaseLedger(git, requireRelease(request.release)) : []
  const identity = await resolveBuildIdentity(request, git)
  if (request.channel === "prod") await assertTrackedBaseline(git)
  const desktopVersion = /^\d+\.\d+\.\d+/.exec(identity.version)?.[0]
  if (!desktopVersion) throw new Error("构建身份缺少 Desktop version")
  const adapter = selectVersionAdapter({ tag: baseline.tag, commit: baseline.commit, desktopVersion })
  await assertBaselineTagCommit(git, adapter)
  const sourceBefore = request.auditOnly ? undefined : await captureGitSourceState(git)
  if (sourceBefore && sourceBefore.head !== identity.commit)
    throw new Error("Git source certification HEAD 与构建身份不一致")
  const paths = createBuildPaths(identity, repositoryRoot)
  const snapshot = await (options.verifySnapshot ?? verifyFrameworkSnapshot)(paths.frameworkRoot)
  return { request, identity, paths, releaseTags, snapshot, sourceBefore, git, adapter }
}

export async function runBuild(argv = Bun.argv.slice(2), options: PreflightOptions = {}) {
  const context = await preflightBuild(argv, options)
  let failureStage: FailureStage = "preflight"
  try {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("BluedCode Desktop 构建仅支持 Windows x64")
    }
    const builderToolchain = resolveBuilderToolchain(context.paths.repositoryRoot)
    const tools = await readToolVersions(context.paths.repositoryRoot, builderToolchain)

    failureStage = "server"
    const server = await buildServer(
      context.paths,
      context.identity,
      { desktopVersion: context.adapter.desktopVersion },
      context.adapter,
    )
    const assetDigest = await validateBrandAssets(context.paths.frameworkRoot)
    const assets = await deriveDesktopAssets(context.paths)
    const electronVite = await loadElectronViteApi(context.paths)
    failureStage = "main"
    await compileElectronVite(
      { adapter: context.adapter, assets, identity: context.identity, paths: context.paths, server },
      electronVite,
    )
    await verifyElectronViteEvidence(context.paths)
    const outputRoot = path.join(context.paths.stageDir, "desktop", "out")
    const adapter = context.adapter
    failureStage = "audit"
    const outputAudit = await auditElectronOutput(outputRoot, adapter.auditPolicy)
    const ledger = await verifyUnifiedLedgerEvidence(context.paths, adapter.modules, server.ledgerFile)
    if (context.request.auditOnly) {
      console.log(`兼容审计完成：${outputRoot}`)
      return { auditOnly: true as const, ledger, outputAudit, server }
    }
    const nativePackageDir = path.join(
      context.paths.repositoryRoot,
      "packages",
      "desktop",
      "node_modules",
      "@lydell",
      "node-pty-win32-x64",
    )
    const packaging = await preparePackagingInput(context.paths, context.identity, nativePackageDir)
    const brandedExecutable = createBrandedExecutableVersionHook({
      identity: context.identity,
      paths: context.paths,
      operations: createReseditVersionOperations({
        moduleFile: builderToolchain.reseditModuleFile,
        readPeMetadata,
        repositoryRoot: context.paths.repositoryRoot,
      }),
    })
    const builderContext = {
      arch: "x64" as const,
      afterSign: brandedExecutable.afterSign,
      assets,
      electronVersion: tools.electron,
      identity: context.identity,
      nativePackageDir,
      paths: context.paths,
      platform: "win32" as const,
    }
    failureStage = "package"
    await packageWindowsDirectory(
      context.paths,
      createBuilderConfig(builderContext),
      context.identity,
      builderToolchain.electronBuilderFile,
    )
    const resourceEditAudit = brandedExecutable.requireAudit()
    const packageRoot = await findPackagedApplicationDirectory(context.paths.outDir)
    const packageAuditResult = await auditPackagedApplication(
      context.paths,
      context.identity,
      assets,
      packaging.nativeManifest,
      packageRoot,
    )
    const artifactFile = path.join(context.paths.outDir, context.identity.artifactName)
    const distributionZip = await createDistributionZip({
      sourceRoot: packageRoot,
      topLevelDirectory: context.identity.artifactDirectoryName,
      zipFile: artifactFile,
    })
    const runtimePackageRoot = await extractDistributionZip({
      zipFile: artifactFile,
      targetRoot: path.join(context.paths.workspaceRoot, "runtime-extract"),
      topLevelDirectory: context.identity.artifactDirectoryName,
    })
    const extractedAudit = await auditPackagedApplication(
      context.paths,
      context.identity,
      assets,
      packaging.nativeManifest,
      runtimePackageRoot,
    )
    if (JSON.stringify(extractedAudit) !== JSON.stringify(packageAuditResult)) {
      throw new Error("最终 zip 解压应用审计与 win-unpacked 审计不一致")
    }
    const packageAudit = packageAuditResult.package
    const peAudit = packageAuditResult.pe
    const distributionAudit = {
      ...distributionZip.audit,
      applicationPe: packageAuditResult.pe,
      nativeExecutableSignatures: packageAuditResult.nativeExecutableSignatures,
      resourceEdit: resourceEditAudit,
    }
    const artifact = distributionZip.artifact
    const transformLedger = await verifyUnifiedLedgerEvidence(context.paths, adapter.modules, server.ledgerFile)
    const digests = await digestBuildInputs(context.paths)
    const release = context.identity.tag
      ? {
          targetTag: context.identity.tag,
          annotatedTagCommand: createAnnotatedTagCommand({
            artifactName: context.identity.artifactName,
            artifactSha256: artifact.sha256,
            commit: context.identity.commit,
            tag: context.identity.tag,
            version: context.identity.version,
          }),
        }
      : { targetTag: null, annotatedTagCommand: null }
    const runtimeHome = await writeRuntimePortableConfig(path.join(context.paths.workspaceRoot, "runtime-home"))
    const runtime = await createRuntimeAcceptanceEvidence({
      executable: path.join(runtimePackageRoot, `${context.identity.name}.exe`),
      mode: "windows-zip",
      home: runtimeHome,
      visibleVersion: context.identity.version,
    })
    const finalized = await withCertifiedGitSource(context.git, context.sourceBefore!, async (sourceAfter) => {
      const manifest = createReleaseManifest({
        identity: context.identity,
        baseline: {
          tag: context.adapter.tag,
          commit: context.adapter.commit,
          desktopVersion: context.adapter.desktopVersion,
        },
        resourceEditorTool: context.adapter.resourceEditorTool,
        builtAtUtc: new Date().toISOString(),
        source: { before: context.sourceBefore!, after: sourceAfter },
        tools,
        digests: { ...digests, assets: assetDigest.digest },
        cache: {
          server: server.cacheHit,
          electronVite: false,
          distributionZip: false,
        },
        release,
        artifact,
        transformation: transformLedger,
        enterprise: { audit: outputAudit },
        audit: {
          output: outputAudit,
          package: packageAudit,
          pe: peAudit,
          distributionZip: distributionAudit,
          runtime,
        },
      })
      const published = await publishRelease({
        artifactsRoot: context.paths.artifactsDir,
        artifactFile,
        manifest,
        outputRoot: context.paths.outputRoot,
        repositoryRoot: context.paths.repositoryRoot,
      })
      return { manifest, published }
    })
    const manifest = finalized.manifest
    const published = finalized.published
    console.log(`产物：${published.artifact}`)
    console.log(`发行清单：${published.manifest}`)
    if (release.targetTag && release.annotatedTagCommand) {
      console.log(`Tag 候选：${release.targetTag}`)
      console.log(`中文 annotated tag 命令（仅输出，未执行）：${release.annotatedTagCommand}`)
    }
    return {
      ...published,
      manifest: published.manifest,
      releaseManifest: manifest,
    }
  } catch (error) {
    await writeBuildFailure(context.paths, context.identity, context.adapter, error, failureStage)
    throw error
  }
}

async function writeBuildFailure(
  paths: ReturnType<typeof createBuildPaths>,
  identity: BuildIdentity,
  adapter: VersionAdapter,
  error: unknown,
  fallbackStage: FailureStage,
) {
  try {
    const digests = await digestBuildInputs(paths)
    const context = readFailureContext(error)
    await writeFailureReport({
      root: paths.stageDir,
      stage: context?.stage ?? fallbackStage,
      code:
        context?.code ??
        (error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "BUILD_FAILED"),
      error,
      gitSha256: sha256(identity.commit),
      productProfileSha256: adapter.productProfileSha256,
      frameworkSha256: digests.framework,
      adapterSha256: digests.adapter,
      lastModule: context?.lastModule ?? null,
      ledgerPath: context?.ledgerPath ?? null,
      symbolBundlePath: context?.symbolBundlePath ?? null,
      secrets: collectConfiguredSecrets([process.env]),
    })
  } catch {
    // Diagnostics must never conceal the original build error.
  }
}

export async function preparePackagingInput(
  paths: ReturnType<typeof createBuildPaths>,
  identity: BuildIdentity,
  nativePackageDir: string,
) {
  const isolation = await prepareIsolation(paths)
  await ensureSafeDirectory(isolation, paths.workspaceRoot)
  await ensureSafeDirectory(isolation, paths.stageDir)
  const packageDir = path.join(paths.stageDir, "package")
  if (await exists(packageDir)) await removeSafeDirectory(isolation, packageDir)
  await ensureSafeDirectory(isolation, packageDir)
  const nativeFiles = await verifyNativeRuntime(nativePackageDir)
  const content = `${JSON.stringify(
    {
      main: "out/main/index.js",
      name: "bluedcode-build-input",
      private: true,
      type: "module",
      version: baseline.desktopVersion,
    },
    null,
    2,
  )}\n`
  const packageFile = path.join(packageDir, "package.json")
  await publishImmutableFile(isolation, packageDir, packageFile, content, sha256(content))
  const nativeRoot = await realpath(nativePackageDir)
  const stagedNativeRoot = path.join(packageDir, "node_modules", "@lydell", "node-pty-win32-x64")
  await ensureSafeDirectory(isolation, stagedNativeRoot)
  const manifestFiles = await Promise.all(
    nativeFiles.map(async (file) => {
      const source = path.join(nativeRoot, ...file.split("/"))
      const target = path.join(stagedNativeRoot, ...file.split("/"))
      await ensureSafeDirectory(isolation, path.dirname(target))
      const bytes = await readFile(source)
      const digest = sha256(bytes)
      await publishImmutableFile(isolation, packageDir, target, bytes, digest)
      return { file, size: bytes.byteLength, sha256: digest }
    }),
  )
  const nativeManifest: NativeRuntimeManifest = {
    version: 1,
    packageName: "@lydell/node-pty-win32-x64",
    packageVersion: "1.2.0-beta.12",
    files: manifestFiles,
  }
  const manifestContent = `${JSON.stringify(nativeManifest, null, 2)}\n`
  const nativeManifestRoot = path.join(paths.stageDir, "packaging")
  await ensureSafeDirectory(isolation, nativeManifestRoot)
  const nativeManifestFile = path.join(nativeManifestRoot, "native-runtime-manifest.json")
  await publishImmutableFile(
    isolation,
    nativeManifestRoot,
    nativeManifestFile,
    manifestContent,
    sha256(manifestContent),
  )
  if (!identity.version.startsWith(`${baseline.desktopVersion}-`)) throw new Error("隔离 package 与构建身份版本不一致")
  return {
    nativeFiles,
    nativeManifest,
    nativeManifestFile,
    packageDir,
    packageFile,
  }
}

export async function auditElectronOutput(root: string, policy: AuditPolicy) {
  await requireConcreteRoot(root, "Electron output")
  const topLevel = await readdir(root, { withFileTypes: true })
  const names = topLevel.map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
  const expected = ["main", "preload", "renderer"]
  if (
    names.length !== expected.length ||
    names.some((name, index) => name !== expected[index]) ||
    topLevel.some((entry) => entry.isSymbolicLink() || !entry.isDirectory())
  ) {
    throw new Error(`Electron output 顶层集合必须是 main/preload/renderer: ${names.join(", ")}`)
  }
  for (const entry of topLevel) await assertConcreteDirectory(root, path.join(root, entry.name))
  const files = await listConcreteFiles(root)
  const executable = files.filter((file) => /\.(?:appimage|bat|cmd|com|exe|msi|ps1|sh|zip)$/i.test(file))
  if (executable.length) throw new Error(`Electron output 含额外 CLI/Web/TUI 可执行产物: ${executable.join(", ")}`)
  const banned: string[] = []
  const runtimeImports: Array<{ file: string; specifier: string }> = []
  for (const file of files) {
    const bytes = await readFile(path.join(root, ...file.split("/")))
    if (bytes.includes(0)) continue
    const text = bytes.toString("utf8")
    if (/^(?:main|preload)\//.test(file) && file.endsWith(".js")) {
      runtimeImports.push(...findForbiddenRuntimeImports(file, text))
    }
    if (/electron-updater|startBackgroundCli|sentry\.io|SENTRY_AUTH_TOKEN|tui\.json/i.test(text)) {
      banned.push(file)
    }
  }
  if (runtimeImports.length) {
    throw new Error(
      `Electron output 含未随包携带的裸运行时依赖: ${runtimeImports.map((item) => `${item.file}:${item.specifier}`).join(", ")}`,
    )
  }
  if (banned.length) throw new Error(`Electron output 含禁用入口或发布面: ${banned.join(", ")}`)
  return scanOutput(root, policy)
}

function findForbiddenRuntimeImports(file: string, text: string) {
  const forbidden: Array<{ file: string; specifier: string }> = []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  visit(source)
  return forbidden

  function record(specifier: string | undefined) {
    if (specifier && !isAllowedPackagedRuntimeImport(specifier)) forbidden.push({ file, specifier })
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) record(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      record(node.arguments[0].text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      record(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
}

function isAllowedPackagedRuntimeImport(specifier: string) {
  if (
    specifier === "electron" ||
    specifier.startsWith("electron/") ||
    specifier === "@lydell/node-pty-win32-x64" ||
    specifier.startsWith("@lydell/node-pty-win32-x64/")
  ) {
    return true
  }
  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[a-zA-Z]:/.test(specifier)) return true
  if (specifier.startsWith("node:")) return true
  return isBuiltin(specifier)
}

export async function auditAsarContents(
  archive: string,
  expectedFiles: readonly AsarExpectedFile[],
  nativeManifest: NativeRuntimeManifest,
) {
  const header = await readAsarHeader(archive)
  const entries = collectAsarEntries(header)
  const files = entries.map((entry) => entry.file).sort()
  const expectedEntries = expectedFiles.map(requireAsarExpectedFile)
  const expected = expectedEntries.map((entry) => entry.file).sort()
  if (new Set(expected).size !== expected.length) throw new Error("ASAR 预期文件集合包含重复路径")
  if (files.length !== expected.length || files.some((file, index) => file !== expected[index])) {
    throw new Error(`ASAR 文件集合不匹配: actual=${files.join(",")} expected=${expected.join(",")}`)
  }
  await Promise.all(
    expectedEntries
      .filter((entry): entry is { file: string; size: number; sha256: string } => entry.size !== undefined)
      .filter((entry) => !entries.some((actual) => actual.file === entry.file && actual.unpacked))
      .map(async (entry) => {
        const bytes = await extractAsarFile(archive, entry.file)
        if (bytes.byteLength !== entry.size) throw new Error(`ASAR packed 大小不匹配: ${entry.file}`)
        if (sha256(bytes) !== entry.sha256) throw new Error(`ASAR packed 摘要不匹配: ${entry.file}`)
      }),
  )
  const unpackedFiles = entries
    .filter((entry) => entry.unpacked)
    .map((entry) => entry.file)
    .sort()
  const declaredNative = requireNativeRuntimeManifest(nativeManifest)
  const nativePrefix = "node_modules/@lydell/node-pty-win32-x64"
  const expectedUnpacked = declaredNative.map((entry) => `${nativePrefix}/${entry.file}`).sort()
  if (
    unpackedFiles.length !== expectedUnpacked.length ||
    unpackedFiles.some((file, index) => file !== expectedUnpacked[index])
  ) {
    throw new Error(`ASAR header unpacked 文件集合不匹配: ${unpackedFiles.join(",")}`)
  }
  const unpackedRoot = `${archive}.unpacked`
  await requireConcreteRoot(unpackedRoot, "ASAR unpacked")
  const actualUnpacked = await listConcreteFiles(unpackedRoot)
  if (
    actualUnpacked.length !== expectedUnpacked.length ||
    actualUnpacked.some((file, index) => file !== expectedUnpacked[index])
  ) {
    throw new Error(`ASAR unpacked 磁盘文件集合不匹配: ${actualUnpacked.join(",")}`)
  }
  await Promise.all(
    declaredNative.map(async (entry) => {
      const relative = `${nativePrefix}/${entry.file}`
      const target = path.join(unpackedRoot, ...relative.split("/"))
      const stats = await lstat(target)
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`ASAR unpacked 不是普通文件: ${relative}`)
      if (stats.size !== entry.size) throw new Error(`ASAR unpacked 大小不匹配: ${relative}`)
      await verifyConcreteFile(unpackedRoot, target, entry.sha256)
    }),
  )
  const nativeExecutables = files.filter((file) => file.toLowerCase().endsWith(".exe"))
  const allowedNativeExecutable = "node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"
  const bannedEntrypoints = nativeExecutables.filter((file) => file !== allowedNativeExecutable)
  if (bannedEntrypoints.length) {
    throw new Error(`ASAR 含额外 CLI/Web/TUI 可执行入口: ${bannedEntrypoints.join(", ")}`)
  }
  return {
    asarFiles: files,
    unpackedFiles,
    nativeExecutables,
    bannedEntrypoints,
    passed: true as const,
  }
}

function requireAsarExpectedFile(input: AsarExpectedFile) {
  if (typeof input === "string")
    return {
      file: requireRelativeFile(input),
      size: undefined,
      sha256: undefined,
    }
  const file = requireRelativeFile(input.file)
  if (!Number.isSafeInteger(input.size) || input.size < 0) throw new Error(`ASAR 预期大小无效: ${file}`)
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error(`ASAR 预期摘要无效: ${file}`)
  return { file, size: input.size, sha256: input.sha256 }
}

function requireNativeRuntimeManifest(manifest: NativeRuntimeManifest) {
  if (
    manifest.version !== 1 ||
    manifest.packageName !== "@lydell/node-pty-win32-x64" ||
    manifest.packageVersion !== "1.2.0-beta.12" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("node-pty native runtime manifest 元数据无效")
  }
  const actual = manifest.files.map((entry) => requireRelativeFile(entry.file))
  if (
    actual.length !== nativeRuntimeFiles.length ||
    actual.some((file, index) => file !== nativeRuntimeFiles[index]) ||
    new Set(actual).size !== actual.length
  ) {
    throw new Error(`node-pty native runtime manifest 文件集合必须是预声明 17 项: ${actual.join(",")}`)
  }
  for (const entry of manifest.files) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`native manifest 大小无效: ${entry.file}`)
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`native manifest 摘要无效: ${entry.file}`)
  }
  return manifest.files
}

export async function findPackagedApplicationDirectory(root: string) {
  await requireConcreteRoot(root, "electron-builder output")
  const entries = await readdir(root, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (entries.some((entry) => entry.isSymbolicLink())) throw new Error("electron-builder output 拒绝链接")
  if (files.some((file) => /\.(?:appimage|bat|cmd|com|exe|msi|ps1|sh)$/i.test(file))) {
    throw new Error(`electron-builder output 不得包含 Portable EXE、MSI 或其他可执行分发产物: ${files.join(", ")}`)
  }
  if (files.length) {
    throw new Error(`electron-builder output 只允许目录，zip 由发布层生成: ${files.join(", ")}`)
  }
  if (directories.length !== 1 || directories[0] !== "win-unpacked") {
    throw new Error(`electron-builder output 目录集合无效: ${directories.join(", ")}`)
  }
  await assertConcreteDirectory(root, path.join(root, "win-unpacked"))
  return path.join(root, "win-unpacked")
}

export async function readPeMetadata(executable: string) {
  if (process.platform !== "win32") throw new Error("PE 审计仅支持 Windows")
  const stats = await lstat(executable)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("PE 审计目标必须是具体普通文件")
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR
  if (!systemRoot) throw new Error("PE 审计缺少 SystemRoot")
  const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$item = Get-Item -LiteralPath $env:BLUEDCODE_PE_FILE",
    "$version = $item.VersionInfo",
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:BLUEDCODE_PE_FILE",
    "[ordered]@{",
    "productName = $version.ProductName",
    "productVersion = $version.ProductVersion",
    "fileVersion = $version.FileVersion",
    'numericFileVersion = "$($version.FileMajorPart).$($version.FileMinorPart).$($version.FileBuildPart).$($version.FilePrivatePart)"',
    'numericProductVersion = "$($version.ProductMajorPart).$($version.ProductMinorPart).$($version.ProductBuildPart).$($version.ProductPrivatePart)"',
    "signatureStatus = $signature.Status.ToString()",
    "} | ConvertTo-Json -Compress",
  ].join("\n")
  const child = Bun.spawn([powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: peEnvironment(executable, systemRoot),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`PowerShell PE 审计失败 (${exitCode}): ${stderr.trim()}`)
  return requirePeMetadata(JSON.parse(stdout))
}

export function validateWindowsApplicationPe(
  metadata: Awaited<ReturnType<typeof readPeMetadata>>,
  identity: BuildIdentity,
): PeAudit {
  const numericVersion = deriveWindowsVersion(identity)
  if (metadata.productName !== identity.name) throw new Error(`品牌应用 PE ProductName 不匹配: ${metadata.productName}`)
  if (metadata.productVersion !== identity.version) {
    throw new Error(`品牌应用 PE ProductVersion 不匹配: ${metadata.productVersion}`)
  }
  if (metadata.fileVersion !== identity.version)
    throw new Error(`品牌应用 PE FileVersion 不匹配: ${metadata.fileVersion}`)
  if (metadata.numericFileVersion !== numericVersion || metadata.numericProductVersion !== numericVersion) {
    throw new Error(
      `品牌应用 PE 数字版本不匹配: file=${metadata.numericFileVersion} product=${metadata.numericProductVersion} expected=${numericVersion}`,
    )
  }
  if (metadata.signatureStatus !== "NotSigned") {
    throw new Error(`品牌应用 EXE 必须 unsigned，实际签名状态: ${metadata.signatureStatus}`)
  }
  return { ...metadata, signatureStatus: "NotSigned", passed: true }
}

export function validateWinUnpackedExecutables(executableFiles: readonly string[], identity: BuildIdentity) {
  const actual = executableFiles.map(requireRelativeFile).sort()
  const openConsole =
    "resources/app.asar.unpacked/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"
  const expected = [`${identity.name}.exe`, openConsole].sort()
  if (new Set(actual).size !== actual.length || actual.length !== expected.length) {
    throw new Error(`win-unpacked 含额外 CLI/Web/TUI EXE: ${actual.join(", ")}`)
  }
  if (actual.some((file, index) => file !== expected[index])) {
    throw new Error(`win-unpacked 含额外 CLI/Web/TUI EXE: ${actual.join(", ")}`)
  }
  return actual
}

function requireRelease(release: string | undefined) {
  if (!release) throw new Error("prod 必须提供 --release")
  return release
}

async function verifyNativeRuntime(nativePackageDir: string) {
  const canonicalRoot = await realpath(nativePackageDir)
  await requireConcreteRoot(canonicalRoot, "node-pty native package")
  await Promise.all(
    nativeRuntimeFiles.map(async (file) => {
      const target = path.join(canonicalRoot, ...file.split("/"))
      const parent = path.dirname(target)
      if (parent !== canonicalRoot) await assertConcreteDirectory(canonicalRoot, parent)
      const stats = await lstat(target).catch((error: unknown) => {
        throw new Error(`node-pty 运行时白名单文件缺失: ${file}: ${String(error)}`)
      })
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`node-pty 运行时白名单不是普通文件: ${file}`)
    }),
  )
  const metadata: unknown = JSON.parse(await readFile(path.join(canonicalRoot, "package.json"), "utf8"))
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("name" in metadata) ||
    metadata.name !== "@lydell/node-pty-win32-x64" ||
    !("version" in metadata) ||
    metadata.version !== "1.2.0-beta.12" ||
    !("os" in metadata) ||
    !Array.isArray(metadata.os) ||
    metadata.os.join(",") !== "win32" ||
    !("cpu" in metadata) ||
    !Array.isArray(metadata.cpu) ||
    metadata.cpu.join(",") !== "x64"
  ) {
    throw new Error("node-pty Windows x64 package 元数据不匹配")
  }
  return [...nativeRuntimeFiles]
}

async function loadElectronViteApi(paths: ReturnType<typeof createBuildPaths>): Promise<ElectronViteApi> {
  const loaded: unknown = await import(pathToFileURL(path.join(paths.versionRoot, "electron-vite.ts")).href)
  if (
    !loaded ||
    typeof loaded !== "object" ||
    !("writeElectronViteContext" in loaded) ||
    typeof loaded.writeElectronViteContext !== "function" ||
    !("createElectronViteChildEnv" in loaded) ||
    typeof loaded.createElectronViteChildEnv !== "function" ||
    !("requiredBuildTargets" in loaded)
  ) {
    throw new Error("Task 6 Electron Vite 公共接口无效")
  }
  const writeContext = loaded.writeElectronViteContext
  const createChildEnv = loaded.createElectronViteChildEnv
  const requiredBuildTargets = requireBuildTargets(loaded.requiredBuildTargets)
  return {
    requiredBuildTargets,
    async writeElectronViteContext(context) {
      const result: unknown = await Reflect.apply(writeContext, undefined, [context])
      if (typeof result !== "string" || !path.isAbsolute(result)) {
        throw new Error("Task 6 Electron Vite context 路径无效")
      }
      return result
    },
    createElectronViteChildEnv(contextFile, source, channel) {
      const result: unknown = Reflect.apply(createChildEnv, undefined, [contextFile, source, channel])
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Task 6 Electron Vite child env 无效")
      }
      const entries = Object.entries(result)
      if (entries.some((entry) => typeof entry[1] !== "string")) {
        throw new Error("Task 6 Electron Vite child env 必须全为字符串")
      }
      return Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    },
  }
}

function requireBuildTargets(input: unknown): ElectronViteApi["requiredBuildTargets"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Task 6 requiredBuildTargets 无效")
  if (Object.keys(input).sort().join(",") !== "main,preload,renderer") {
    throw new Error("Task 6 requiredBuildTargets 顶层 schema 无效")
  }
  return {
    main: requireBuildTarget(input, "main"),
    preload: requireBuildTarget(input, "preload"),
    renderer: requireBuildTarget(input, "renderer"),
  }
}

function requireBuildTarget(input: object, target: "main" | "preload" | "renderer") {
  if (!(target in input) || !Array.isArray(input[target]) || !input[target].every((file) => typeof file === "string")) {
    throw new Error(`Task 6 requiredBuildTargets.${target} 无效`)
  }
  return input[target].filter((file): file is string => typeof file === "string")
}

function requireAuditPolicy(input: unknown): AuditPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("版本适配器 audit policy 无效")
  if (
    !("tokens" in input) ||
    !Array.isArray(input.tokens) ||
    !input.tokens.every((token) => typeof token === "string")
  ) {
    throw new Error("版本适配器 audit tokens 无效")
  }
  if (!("allow" in input) || !Array.isArray(input.allow)) throw new Error("版本适配器 audit allowlist 无效")
  const allow = input.allow.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("版本适配器 audit allowance 无效")
    }
    if (
      !("id" in value) ||
      typeof value.id !== "string" ||
      !("path" in value) ||
      typeof value.path !== "string" ||
      !("token" in value) ||
      typeof value.token !== "string" ||
      !("expected" in value) ||
      (value.expected !== "any" && typeof value.expected !== "number") ||
      !("classification" in value) ||
      !["forbidden", "preserved", "evidence"].includes(String(value.classification)) ||
      !("reason" in value) ||
      typeof value.reason !== "string"
    ) {
      throw new Error("版本适配器 audit allowance 字段无效")
    }
    const classification = requireAuditClassification(value.classification)
    return {
      id: value.id,
      path: value.path,
      token: value.token,
      expected: value.expected,
      classification,
      reason: value.reason,
    }
  })
  return {
    tokens: input.tokens.filter((token): token is string => typeof token === "string"),
    allow,
  }
}

function requireAuditClassification(value: unknown): AuditAllowance["classification"] {
  if (value === "forbidden" || value === "preserved" || value === "evidence") return value
  throw new Error("版本适配器 audit classification 无效")
}

type ElectronViteBuildContext = {
  adapter: VersionAdapter
  assets: DerivedAssets
  identity: BuildIdentity
  paths: ReturnType<typeof createBuildPaths>
  server: Pick<ServerBundle, "file" | "digest" | "size" | "assets">
}

async function assertBaselineTagCommit(git: Git, adapter: VersionAdapter) {
  const result = await git.run(["rev-parse", `${adapter.tag}^{}`])
  const commit = result.stdout.trim()
  if (result.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("无法读取受信基线 tag")
  if (commit !== adapter.commit) {
    throw new Error(`受信基线 tag ${adapter.tag} 指向 ${commit}，与适配器 commit ${adapter.commit} 不一致`)
  }
}

type ElectronViteApi = {
  createElectronViteChildEnv(
    contextFile: string,
    source: Readonly<Record<string, string | undefined>>,
    channel: BuildIdentity["channel"],
  ): Record<string, string>
  requiredBuildTargets: Record<"main" | "preload" | "renderer", readonly string[]>
  writeElectronViteContext(context: ElectronViteBuildContext): Promise<string>
}

async function compileElectronVite(context: ElectronViteBuildContext, api: ElectronViteApi) {
  const contextFile = await api.writeElectronViteContext(context)
  await resetElectronViteEvidence(context.paths)
  const cli = path.join(
    context.paths.repositoryRoot,
    "packages",
    "desktop",
    "node_modules",
    "electron-vite",
    "bin",
    "electron-vite.js",
  )
  const config = path.join(context.paths.versionRoot, "electron-vite.ts")
  const child = Bun.spawn([process.execPath, cli, "build", "--config", config, "--logLevel", "warn"], {
    cwd: path.join(context.paths.repositoryRoot, "packages", "desktop"),
    env: api.createElectronViteChildEnv(contextFile, process.env, context.identity.channel),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Electron Vite 构建失败 (${exitCode})\n${stdout}\n${stderr}`)
  if (/\bwarn(?:ing)?\b/i.test(`${stdout}\n${stderr}`)) {
    throw new Error(`Electron Vite 构建输出 warning\n${stdout}\n${stderr}`)
  }
}

async function resetElectronViteEvidence(paths: ReturnType<typeof createBuildPaths>) {
  const isolation = await prepareIsolation(paths)
  const root = path.join(paths.stageDir, "electron-vite")
  for (const directory of ["ledgers", "audits"]) {
    const target = path.join(root, directory)
    if (await exists(target)) await removeSafeDirectory(isolation, target)
    await ensureSafeDirectory(isolation, target)
  }
}

export async function verifyElectronViteEvidence(paths: ReturnType<typeof createBuildPaths>) {
  const outputRoot = path.join(paths.stageDir, "desktop", "out")
  const artifacts = await Promise.all(
    (await listConcreteFiles(outputRoot)).map(async (file) => {
      const bytes = await readFile(path.join(outputRoot, ...file.split("/")))
      return { file, size: bytes.byteLength, digest: sha256(bytes) }
    }),
  )
  const auditRoot = path.join(paths.stageDir, "electron-vite", "audits")
  await requireConcreteRoot(auditRoot, "Electron Vite audit")
  const matches = await Promise.all(
    (await readdir(auditRoot))
      .filter((file) => /^output-audit-[a-f0-9]{64}\.json$/.test(file))
      .map(async (file) => {
        const parsed: unknown = JSON.parse(await readFile(path.join(auditRoot, file), "utf8"))
        return isOutputAudit(parsed) && JSON.stringify(parsed.artifacts) === JSON.stringify(artifacts)
      }),
  )
  if (matches.filter(Boolean).length !== 1) throw new Error("Electron Vite 缺少当前 out 的唯一 output audit")
}

async function verifyUnifiedLedgerEvidence(
  paths: ReturnType<typeof createBuildPaths>,
  expectedModules: readonly { id: string; file: string; stage: "server" | "main" | "preload" | "renderer" }[],
  serverLedgerFile: string,
) {
  const serverRoot = path.join(paths.stageDir, "ledger", "server")
  const electronRoot = path.join(paths.stageDir, "ledger", "electron")
  await Promise.all([
    requireConcreteRoot(serverRoot, "当前 server 统一 ledger"),
    requireConcreteRoot(electronRoot, "当前 Electron 统一 ledger"),
  ])
  const relativeServerLedger = path.relative(serverRoot, serverLedgerFile)
  if (
    !relativeServerLedger ||
    path.isAbsolute(relativeServerLedger) ||
    relativeServerLedger.startsWith(`..${path.sep}`)
  ) {
    throw new Error("当前 server ledger 越出受控目录")
  }
  const electronLedgerFiles = (await listConcreteFiles(electronRoot)).filter((file) =>
    /^unified-ledger-[a-f0-9]{64}\.json$/.test(file),
  )
  if (electronLedgerFiles.length !== 1) throw new Error("构建缺少当前 Electron 统一 ledger")
  const ledgers = await Promise.all(
    [serverLedgerFile, path.join(electronRoot, electronLedgerFiles[0]!)].map(
      async (file) => JSON.parse(await readFile(file, "utf8")) as UnifiedLedger,
    ),
  )
  ledgers.forEach(validateLedger)
  const events = ledgers.flatMap((ledger) => ledger.events)
  const actual = new Set(events.map((event) => `${event.stage}\0${event.moduleId}\0${event.file}`))
  const expected = new Set(expectedModules.map((module) => `${module.stage}\0${module.id}\0${module.file}`))
  if (actual.size !== events.length || actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error("统一 ledger 未逐项覆盖 ModuleContract")
  }
  if (new Set(events.map((event) => event.productProfileSha256)).size !== 1) {
    throw new Error("统一 ledger 产品 Profile 摘要不一致")
  }
  const ledger = {
    version: 2 as const,
    events: events.sort((left, right) =>
      `${left.stage}:${left.moduleId}`.localeCompare(`${right.stage}:${right.moduleId}`),
    ),
  }
  return { ledger, sha256: sha256(`${JSON.stringify(ledger, null, 2)}\n`) }
}

export async function packageWindowsDirectory(
  paths: ReturnType<typeof createBuildPaths>,
  config: ReturnType<typeof createBuilderConfig>,
  identity: BuildIdentity,
  moduleFile: string,
) {
  const isolation = await prepareIsolation(paths)
  if (await exists(paths.outDir)) await removeSafeDirectory(isolation, paths.outDir)
  await ensureSafeDirectory(isolation, paths.outDir)
  const desktop = path.join(paths.repositoryRoot, "packages", "desktop")
  if (!path.isAbsolute(moduleFile)) throw new Error("electron-builder module 路径必须是绝对路径")
  const previous = clearSensitiveEnvironment()
  const previousCwd = process.cwd()
  const restoreDebugCallbacks: Array<() => void> = []
  try {
    const loaded: unknown = await import(pathToFileURL(moduleFile).href)
    if (!isElectronBuilderModule(loaded)) throw new Error("electron-builder programmatic API 无效")
    const targets = loaded.Platform.WINDOWS.createTarget(["dir"], loaded.Arch.x64)
    restoreDebugCallbacks.push(await forceElectronBuilderDebugOff(moduleFile))
    process.chdir(paths.workspaceRoot)
    const artifacts = await loaded.build({
      config,
      projectDir: desktop,
      publish: "never",
      targets,
    })
    if (
      artifacts.some((artifact) => path.basename(artifact).endsWith(".exe") || path.basename(artifact).endsWith(".zip"))
    ) {
      throw new Error(`electron-builder 不得直接报告单文件分发产物: ${artifacts.join(", ")}`)
    }
    await findPackagedApplicationDirectory(paths.outDir)
  } finally {
    try {
      try {
        process.chdir(previousCwd)
      } finally {
        restoreDebugCallbacks.toReversed().forEach((restoreDebug) => restoreDebug())
      }
    } finally {
      restoreSensitiveEnvironment(previous)
    }
  }
}

async function auditPackagedApplication(
  paths: ReturnType<typeof createBuildPaths>,
  identity: BuildIdentity,
  assets: Awaited<ReturnType<typeof deriveDesktopAssets>>,
  nativeManifest: NativeRuntimeManifest,
  unpackedRoot: string,
) {
  const asar = path.join(unpackedRoot, "resources", "app.asar")
  const outputRoot = path.join(paths.stageDir, "desktop", "out")
  const outputFiles = await Promise.all(
    (await listConcreteFiles(outputRoot)).map(async (file) => asarExpectedFile(outputRoot, `out/${file}`, file)),
  )
  const assetRoot = path.dirname(assets.iconIco)
  if (
    ![assets.faviconPng, assets.faviconSvg, assets.wordmarkPng, assets.wordmarkSvg].every(
      (file) => path.dirname(file) === assetRoot,
    )
  ) {
    throw new Error("Task 5 派生资源目录不一致")
  }
  const expected = [
    asarExpectedContent("package.json", createAsarPackageJson(identity)),
    ...outputFiles,
    await asarExpectedFile(assetRoot, "assets/favicon.png", path.basename(assets.faviconPng)),
    await asarExpectedFile(assetRoot, "assets/favicon.svg", path.basename(assets.faviconSvg)),
    await asarExpectedFile(assetRoot, "assets/icon.ico", path.basename(assets.iconIco)),
    await asarExpectedFile(assetRoot, "assets/wordmark.png", path.basename(assets.wordmarkPng)),
    await asarExpectedFile(assetRoot, "assets/wordmark.svg", path.basename(assets.wordmarkSvg)),
    ...nativeRuntimeFiles.map((file) => `node_modules/@lydell/node-pty-win32-x64/${file}`),
  ]
  const result = await auditAsarContents(asar, expected, nativeManifest)
  const packageMetadata: unknown = JSON.parse((await extractAsarFile(asar, "package.json")).toString("utf8"))
  if (
    !packageMetadata ||
    typeof packageMetadata !== "object" ||
    !("name" in packageMetadata) ||
    packageMetadata.name !== (identity.channel === "prod" ? "bluedcode-desktop" : "bluedcode-desktop-dev") ||
    !("version" in packageMetadata) ||
    packageMetadata.version !== identity.version ||
    !("main" in packageMetadata) ||
    packageMetadata.main !== "out/main/index.js"
  ) {
    throw new Error("ASAR package.json 未保留完整 BluedCode 身份")
  }
  const executableFiles = (await listConcreteFiles(unpackedRoot)).filter((file) => file.toLowerCase().endsWith(".exe"))
  const appExecutable = `${identity.name}.exe`
  validateWinUnpackedExecutables(executableFiles, identity)
  const pe = validateWindowsApplicationPe(await readPeMetadata(path.join(unpackedRoot, appExecutable)), identity)
  const nativeExecutable =
    "resources/app.asar.unpacked/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"
  const nativeMetadata = await readPeMetadata(path.join(unpackedRoot, ...nativeExecutable.split("/")))
  if (nativeMetadata.signatureStatus !== "Valid") {
    throw new Error(`node-pty OpenConsole.exe Authenticode 签名无效: ${nativeMetadata.signatureStatus}`)
  }
  return {
    package: result,
    pe,
    nativeExecutableSignatures: [
      {
        file: nativeExecutable,
        signatureStatus: nativeMetadata.signatureStatus,
      },
    ],
  }
}

async function asarExpectedFile(root: string, file: string, sourceFile: string) {
  const bytes = await readFile(path.join(root, ...sourceFile.split("/")))
  return { file, size: bytes.byteLength, sha256: sha256(bytes) }
}

function asarExpectedContent(file: string, content: string) {
  const bytes = Buffer.from(content)
  return { file, size: bytes.byteLength, sha256: sha256(bytes) }
}

export function createAsarPackageJson(identity: BuildIdentity) {
  return JSON.stringify(
    {
      main: "out/main/index.js",
      name: identity.channel === "prod" ? "bluedcode-desktop" : "bluedcode-desktop-dev",
      private: true,
      type: "module",
      version: identity.version,
      author: { name: "ForeachCode" },
      description: "BluedCode Windows Desktop",
      productName: identity.name,
    },
    null,
    2,
  )
}

type BuilderToolchain = ReturnType<typeof resolveBuilderToolchain>

function resolveBuilderToolchain(repositoryRoot: string) {
  const desktop = path.join(repositoryRoot, "packages", "desktop")
  const electronBuilderFile = Bun.resolveSync("electron-builder", desktop)
  const appBuilderLibFile = Bun.resolveSync("app-builder-lib", electronBuilderFile)
  const reseditModuleFile = Bun.resolveSync("resedit", appBuilderLibFile)
  return { electronBuilderFile, appBuilderLibFile, reseditModuleFile }
}

async function readToolVersions(repositoryRoot: string, toolchain: BuilderToolchain) {
  const desktop = path.join(repositoryRoot, "packages", "desktop", "node_modules")
  const [electron, electronBuilder, appBuilderLib, electronVite, resedit] = await Promise.all([
    readPackageVersion(path.join(desktop, "electron", "package.json"), "electron"),
    readPackageVersion(packageFileForModule(toolchain.electronBuilderFile), "electron-builder"),
    readPackageVersion(packageFileForModule(toolchain.appBuilderLibFile), "app-builder-lib"),
    readPackageVersion(path.join(desktop, "electron-vite", "package.json"), "electron-vite"),
    readPackageVersion(packageFileForModule(toolchain.reseditModuleFile), "resedit"),
  ])
  if (electronBuilder !== "26.15.2" || appBuilderLib !== "26.15.2" || resedit !== "1.7.2") {
    throw new Error(
      `Windows 资源工具版本不匹配: electron-builder=${electronBuilder} app-builder-lib=${appBuilderLib} resedit=${resedit}`,
    )
  }
  return {
    bun: Bun.version,
    electron,
    electronBuilder,
    appBuilderLib,
    electronVite,
    resedit,
  }
}

function packageFileForModule(moduleFile: string) {
  if (!path.isAbsolute(moduleFile)) throw new Error("工具 module 路径必须是绝对路径")
  return path.resolve(path.dirname(moduleFile), "..", "package.json")
}

async function readPackageVersion(file: string, expectedName: string) {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("name" in parsed) ||
    parsed.name !== expectedName ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(parsed.version)
  ) {
    throw new Error(`工具 package 无效: ${expectedName}`)
  }
  return parsed.version
}

function isOutputAudit(input: unknown): input is {
  version: 1
  topLevel: string[]
  artifacts: Array<{ file: string; size: number; digest: string }>
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  if (!("version" in input) || input.version !== 1) return false
  if (
    !("topLevel" in input) ||
    !Array.isArray(input.topLevel) ||
    input.topLevel.join(",") !== "main,preload,renderer"
  ) {
    return false
  }
  if (!("artifacts" in input) || !Array.isArray(input.artifacts)) return false
  return input.artifacts.every(
    (artifact) =>
      !!artifact &&
      typeof artifact === "object" &&
      "file" in artifact &&
      typeof artifact.file === "string" &&
      "size" in artifact &&
      typeof artifact.size === "number" &&
      "digest" in artifact &&
      typeof artifact.digest === "string",
  )
}

type ElectronBuilderModule = {
  Arch: { x64: unknown }
  Platform: {
    WINDOWS: { createTarget(targets: string[], arch: unknown): unknown }
  }
  build(options: {
    config: ReturnType<typeof createBuilderConfig>
    projectDir: string
    publish: "never"
    targets: unknown
  }): Promise<string[]>
}

export function isElectronBuilderModule(input: unknown): input is ElectronBuilderModule {
  return (
    !!input &&
    typeof input === "object" &&
    "build" in input &&
    typeof input.build === "function" &&
    "Arch" in input &&
    !!input.Arch &&
    typeof input.Arch === "object" &&
    "x64" in input.Arch &&
    "Platform" in input &&
    !!input.Platform &&
    (typeof input.Platform === "object" || typeof input.Platform === "function") &&
    "WINDOWS" in input.Platform &&
    !!input.Platform.WINDOWS &&
    typeof input.Platform.WINDOWS === "object" &&
    "createTarget" in input.Platform.WINDOWS &&
    typeof input.Platform.WINDOWS.createTarget === "function"
  )
}

export async function forceElectronBuilderDebugOff(electronBuilderFile: string) {
  if (!path.isAbsolute(electronBuilderFile)) throw new Error("electron-builder module 路径必须是绝对路径")
  const utilityFile = Bun.resolveSync("builder-util", electronBuilderFile)
  const loaded: unknown = await import(pathToFileURL(utilityFile).href)
  if (!loaded || typeof loaded !== "object" || !("debug" in loaded) || typeof loaded.debug !== "function") {
    throw new Error("builder-util debug API 无效")
  }
  const debug = loaded.debug
  const previous: unknown = Reflect.get(debug, "enabled")
  if (previous !== undefined && typeof previous !== "boolean") {
    throw new Error("builder-util debug.enabled 必须是 boolean 或 undefined")
  }
  if (!Reflect.set(debug, "enabled", false) || Reflect.get(debug, "enabled") !== false) {
    throw new Error("无法关闭 electron-builder debug 副产物")
  }
  return () => {
    if (!Reflect.set(debug, "enabled", previous) || Reflect.get(debug, "enabled") !== previous) {
      throw new Error("无法恢复 electron-builder debug 状态")
    }
  }
}

const sensitiveEnvironment = [
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "EP_DRAFT",
  "EP_PRE_RELEASE",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_RELEASE",
  "VITE_SENTRY_DSN",
  "VITE_SENTRY_RELEASE",
  "WIN_CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
] as const

function clearSensitiveEnvironment() {
  const previous = new Map<string, string | undefined>()
  for (const key of sensitiveEnvironment) {
    previous.set(key, process.env[key])
    process.env[key] = ""
  }
  return previous
}

function restoreSensitiveEnvironment(previous: ReadonlyMap<string, string | undefined>) {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function extractAsarFile(archive: string, file: string) {
  const loaded = await loadAsarModule()
  const content: unknown = loaded.extractFile(archive, path.join(...file.split("/")))
  if (!(content instanceof Uint8Array)) throw new Error(`ASAR 文件读取失败: ${file}`)
  return Buffer.from(content)
}

async function loadAsarModule(): Promise<{
  extractFile(archive: string, file: string): unknown
  getRawHeader(archive: string): unknown
}> {
  const desktop = path.resolve(import.meta.dir, "../../../packages/desktop")
  const electronBuilder = Bun.resolveSync("electron-builder", desktop)
  const appBuilder = Bun.resolveSync("app-builder-lib", electronBuilder)
  const moduleFile = Bun.resolveSync("@electron/asar", appBuilder)
  const loaded: unknown = await import(pathToFileURL(moduleFile).href)
  if (
    !loaded ||
    typeof loaded !== "object" ||
    !("getRawHeader" in loaded) ||
    typeof loaded.getRawHeader !== "function" ||
    !("extractFile" in loaded) ||
    typeof loaded.extractFile !== "function"
  ) {
    throw new Error("@electron/asar API 无效")
  }
  const extractFile = loaded.extractFile
  const getRawHeader = loaded.getRawHeader
  return {
    extractFile(archive, file) {
      return Reflect.apply(extractFile, undefined, [archive, file])
    },
    getRawHeader(archive) {
      return Reflect.apply(getRawHeader, undefined, [archive])
    },
  }
}

async function readAsarHeader(archive: string): Promise<unknown> {
  const loaded = await loadAsarModule()
  const raw: unknown = loaded.getRawHeader(archive)
  if (!raw || typeof raw !== "object" || !("header" in raw)) throw new Error("ASAR header 无效")
  return raw.header
}

function collectAsarEntries(header: unknown) {
  const entries: Array<{ file: string; unpacked: boolean }> = []
  visit(header, "")
  return entries

  function visit(node: unknown, relative: string) {
    if (!node || typeof node !== "object") throw new Error(`ASAR entry 无效: ${relative}`)
    if ("link" in node) throw new Error(`ASAR 拒绝链接: ${relative}`)
    if ("files" in node) {
      if (!node.files || typeof node.files !== "object" || Array.isArray(node.files)) {
        throw new Error(`ASAR directory 无效: ${relative}`)
      }
      for (const [name, child] of Object.entries(node.files)) {
        if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
          throw new Error(`ASAR entry 名称无效: ${name}`)
        }
        visit(child, relative ? `${relative}/${name}` : name)
      }
      return
    }
    if (!("size" in node) || typeof node.size !== "number" || !Number.isSafeInteger(node.size) || node.size < 0) {
      throw new Error(`ASAR file 无效: ${relative}`)
    }
    entries.push({
      file: requireRelativeFile(relative),
      unpacked: "unpacked" in node && node.unpacked === true,
    })
  }
}

async function requireConcreteRoot(root: string, label: string) {
  const stats = await lstat(root)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} 必须是具体目录`)
}

async function listConcreteFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort()

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`产物审计拒绝链接: ${childRelative}`)
      if (entry.isDirectory()) {
        await assertConcreteDirectory(root, child)
        await visit(child, childRelative)
        continue
      }
      if (!entry.isFile()) throw new Error(`产物审计拒绝非普通文件: ${childRelative}`)
      files.push(childRelative)
    }
  }
}

function requireRelativeFile(file: string) {
  if (
    !file ||
    file.includes("\0") ||
    file.includes("\\") ||
    path.posix.isAbsolute(file) ||
    /^[a-zA-Z]:/.test(file) ||
    path.posix.normalize(file) !== file ||
    file.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`产物路径必须是规范 POSIX relative file: ${file}`)
  }
  return file
}

function peEnvironment(executable: string, systemRoot: string) {
  const environment: Record<string, string> = {
    BLUEDCODE_PE_FILE: path.resolve(executable),
    SystemRoot: systemRoot,
    WINDIR: process.env.WINDIR ?? systemRoot,
  }
  for (const key of ["PATH", "PATHEXT", "TEMP", "TMP"] as const) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  return environment
}

function requirePeMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("PE 元数据 JSON 无效")
  if (!("productName" in input) || typeof input.productName !== "string") throw new Error("PE ProductName 无效")
  if (!("productVersion" in input) || typeof input.productVersion !== "string") {
    throw new Error("PE ProductVersion 无效")
  }
  if (!("fileVersion" in input) || typeof input.fileVersion !== "string") throw new Error("PE FileVersion 无效")
  if (!("numericFileVersion" in input) || typeof input.numericFileVersion !== "string") {
    throw new Error("PE numeric FileVersion 无效")
  }
  if (!("numericProductVersion" in input) || typeof input.numericProductVersion !== "string") {
    throw new Error("PE numeric ProductVersion 无效")
  }
  if (!("signatureStatus" in input) || typeof input.signatureStatus !== "string") {
    throw new Error("PE signatureStatus 无效")
  }
  if (
    Object.keys(input).sort().join(",") !==
    "fileVersion,numericFileVersion,numericProductVersion,productName,productVersion,signatureStatus"
  ) {
    throw new Error("PE 元数据 schema 无效")
  }
  return {
    productName: input.productName,
    productVersion: input.productVersion,
    fileVersion: input.fileVersion,
    numericFileVersion: input.numericFileVersion,
    numericProductVersion: input.numericProductVersion,
    signatureStatus: input.signatureStatus,
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

if (import.meta.main) {
  await runBuild().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
