import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rename } from "node:fs/promises"
import path from "node:path"
import {
  assertConcreteDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  publishImmutableFile,
  removeSafeDirectory,
  verifyConcreteFile,
} from "./isolation"
import type { BuildPaths } from "./paths"

type LockedFile = { file: string; size: number; sha256: string }
type LockedDownload = LockedFile & { url: string }
export type PayloadFile = { file: string; size: number; sha256: string }
export type WindowsArchivePath = { file: string; windowsKey: string }

export const portableExtractorLock = {
  version: "26.02",
  runner: {
    file: "7zr.exe",
    url: "https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe",
    size: 602112,
    sha256: "56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72",
  },
  installer: {
    file: "7z2602-x64.exe",
    url: "https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe",
    size: 1657896,
    sha256: "6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0",
  },
  executable: {
    file: "7z.exe",
    size: 576000,
    sha256: "83967f1b02b43c4efeda302795722c809e0e81b8307de73558d10484d5676a7d",
  },
  library: {
    file: "7z.dll",
    size: 1906688,
    sha256: "69fd4df057985c40e510e2fac182881c7f85e90aa13ec703f763a8fdb2ce61f8",
  },
} as const satisfies {
  version: string
  runner: LockedDownload
  installer: LockedDownload
  executable: LockedFile
  library: LockedFile
}

export const nsisControlPayload = [
  {
    file: "$PLUGINSDIR/StdUtils.dll",
    size: 102400,
    sha256: "b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e",
  },
  {
    file: "$PLUGINSDIR/System.dll",
    size: 12288,
    sha256: "3eb38ae99653a7dbc724132ee240f6e5c4af4bfe7c01d31d23faf373f9f2eaca",
  },
] as const satisfies readonly PayloadFile[]

export type PortablePayloadAudit = {
  extractor: {
    version: typeof portableExtractorLock.version
    cacheHit: boolean
    cacheDirectory: string
    toolPath: string
    runner: typeof portableExtractorLock.runner
    installer: typeof portableExtractorLock.installer
    executable: typeof portableExtractorLock.executable
    library: typeof portableExtractorLock.library
  }
  archive: { type: "Nsis"; method: "Deflate"; subtype: "NSIS-3 Unicode" }
  controlPayload: PayloadFile[]
  siblingTree: { files: number; sha256: string }
  extractedTree: { files: number; sha256: string }
  payloadTreesEqual: true
  extractedApplicationAudited: true
  passed: true
}

export async function auditFinalPortablePayload<Result>(input: {
  executable: string
  siblingRoot: string
  paths: Pick<BuildPaths, "outputRoot" | "repositoryRoot" | "workspaceRoot">
  auditApplication(root: string): Promise<Result>
}) {
  const isolation = await prepareIsolation(input.paths)
  await assertConcreteDirectory(input.paths.outputRoot, input.paths.workspaceRoot)
  await assertConcreteDirectory(input.paths.workspaceRoot, input.siblingRoot)
  await requireConcreteFile(input.paths.workspaceRoot, input.executable, "Portable EXE")
  const extractor = await preparePortableExtractor(input.paths)
  const auditRoot = path.join(input.paths.workspaceRoot, "portable-audit")
  await ensureSafeDirectory(isolation, auditRoot)
  const extractionRoot = path.join(auditRoot, `.tmp-extracted-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, extractionRoot)
  try {
    const listing = await runTool(extractor.executable, ["l", "-slt", input.executable])
    const listed = requireNsisListing(listing)
    await runTool(extractor.executable, ["x", "-bd", "-bb0", "-y", `-o${extractionRoot}`, input.executable])
    await assertConcreteDirectory(auditRoot, extractionRoot)
    const extracted = await createTreeManifest(extractionRoot)
    validateWindowsArchivePaths(
      listed.entries.map((entry) => entry.file),
      extracted.map((entry) => entry.file),
    )
    const control = extracted.filter((entry) => entry.file.startsWith("$PLUGINSDIR/"))
    requireExactFiles(control, nsisControlPayload, "NSIS $PLUGINSDIR 控制载荷")
    const extractedApplication = extracted.filter((entry) => !entry.file.startsWith("$PLUGINSDIR/"))
    const sibling = await createTreeManifest(input.siblingRoot)
    requireExactFiles(extractedApplication, sibling, "最终 Portable 与 win-unpacked 载荷树")
    await removeSafeDirectory(isolation, path.join(extractionRoot, "$PLUGINSDIR"))
    const application = await input.auditApplication(extractionRoot)
    return {
      application,
      portable: {
        extractor: extractor.audit,
        archive: listed.archive,
        controlPayload: control,
        siblingTree: treeEvidence(sibling),
        extractedTree: treeEvidence(extractedApplication),
        payloadTreesEqual: true,
        extractedApplicationAudited: true,
        passed: true,
      } satisfies PortablePayloadAudit,
    }
  } finally {
    if (await exists(extractionRoot)) await removeSafeDirectory(isolation, extractionRoot)
  }
}

async function preparePortableExtractor(paths: Pick<BuildPaths, "outputRoot" | "repositoryRoot">) {
  const isolation = await prepareIsolation(paths)
  const toolCacheRoot = path.join(paths.outputRoot, "tool-cache")
  await ensureSafeDirectory(isolation, toolCacheRoot)
  const cacheDirectory = path.join(toolCacheRoot, `7zip-${portableExtractorLock.version}`)
  const cacheHit = await exists(cacheDirectory)
  if (!cacheHit) await provisionPortableExtractor(isolation, toolCacheRoot, cacheDirectory)
  const executable = await verifyPortableExtractor(cacheDirectory)
  return {
    executable,
    audit: {
      version: portableExtractorLock.version,
      cacheHit,
      cacheDirectory: slash(path.relative(paths.outputRoot, cacheDirectory)),
      toolPath: slash(path.relative(paths.outputRoot, executable)),
      runner: portableExtractorLock.runner,
      installer: portableExtractorLock.installer,
      executable: portableExtractorLock.executable,
      library: portableExtractorLock.library,
    },
  }
}

async function provisionPortableExtractor(
  isolation: Awaited<ReturnType<typeof prepareIsolation>>,
  toolCacheRoot: string,
  cacheDirectory: string,
) {
  const temporary = path.join(toolCacheRoot, `.tmp-7zip-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, temporary)
  try {
    const [runner, installer] = await Promise.all([
      downloadLockedFile(isolation, temporary, portableExtractorLock.runner),
      downloadLockedFile(isolation, temporary, portableExtractorLock.installer),
    ])
    const payload = path.join(temporary, "payload")
    await ensureSafeDirectory(isolation, payload)
    await runTool(runner, ["x", "-bd", "-bb0", "-y", `-o${payload}`, installer, "7z.exe", "7z.dll"])
    await verifyPortableExtractor(payload)
    try {
      await rename(payload, cacheDirectory)
    } catch (error) {
      if (!(await exists(cacheDirectory))) throw error
      await verifyPortableExtractor(cacheDirectory)
    }
  } finally {
    if (await exists(temporary)) await removeSafeDirectory(isolation, temporary)
  }
}

async function downloadLockedFile(
  isolation: Awaited<ReturnType<typeof prepareIsolation>>,
  directory: string,
  lock: LockedDownload,
) {
  const response = await fetch(lock.url, { redirect: "follow" })
  if (!response.ok) throw new Error(`下载锁定 7-Zip 工具失败 (${response.status}): ${lock.url}`)
  const content = Buffer.from(await response.arrayBuffer())
  requireLockedBytes(content, lock, `下载的 ${lock.file}`)
  return publishImmutableFile(isolation, directory, path.join(directory, lock.file), content, lock.sha256)
}

async function verifyPortableExtractor(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true })
  const expected = [portableExtractorLock.executable.file, portableExtractorLock.library.file].sort()
  const actual = entries.map((entry) => entry.name).sort()
  if (
    entries.some((entry) => entry.isSymbolicLink() || !entry.isFile()) ||
    actual.length !== expected.length ||
    actual.some((file, index) => file !== expected[index])
  ) {
    throw new Error(`7-Zip tool cache 文件集合无效: ${actual.join(",")}`)
  }
  await Promise.all([
    verifyLockedFile(directory, portableExtractorLock.executable),
    verifyLockedFile(directory, portableExtractorLock.library),
  ])
  const executable = path.join(directory, portableExtractorLock.executable.file)
  const information = await runTool(executable, ["i"])
  if (!information.includes("7-Zip 26.02") || !/\bNsis\b/.test(information)) {
    throw new Error("锁定 7-Zip 26.02 缺少 NSIS handler")
  }
  return executable
}

async function verifyLockedFile(directory: string, lock: LockedFile) {
  const target = path.join(directory, lock.file)
  const stats = await lstat(target)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== lock.size) {
    throw new Error(`锁定工具大小或文件类型无效: ${lock.file}`)
  }
  await verifyConcreteFile(directory, target, lock.sha256)
}

async function createTreeManifest(root: string) {
  const files: PayloadFile[] = []
  await requireConcreteDirectory(root, "载荷树")
  await visit(root, "")
  return files.sort((left, right) => left.file.localeCompare(right.file))

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      const file = requireWindowsArchivePath(childRelative, "提取载荷").file
      if (entry.isSymbolicLink()) throw new Error(`Portable 提取载荷拒绝链接或 reparse point: ${file}`)
      if (entry.isDirectory()) {
        await assertConcreteDirectory(root, child)
        await visit(child, file)
        continue
      }
      if (!entry.isFile()) throw new Error(`Portable 提取载荷拒绝非普通文件: ${file}`)
      const stats = await lstat(child)
      const content = await readFile(child)
      files.push({ file, size: stats.size, sha256: sha256(content) })
    }
  }
}

function requireNsisListing(output: string) {
  if (!/^Type = Nsis$/m.test(output)) throw new Error("Portable 最终 EXE 不是锁定的 NSIS archive")
  if (!/^Method = Deflate$/m.test(output)) throw new Error("Portable NSIS archive 压缩方法不是 Deflate")
  if (!/^SubType = NSIS-3 Unicode$/m.test(output)) throw new Error("Portable NSIS archive subtype 无效")
  const marker = output.indexOf("----------")
  if (marker < 0) throw new Error("Portable NSIS archive 缺少文件清单")
  const paths = output
    .slice(marker)
    .split(/\r?\n/)
    .flatMap((line) => (line.startsWith("Path = ") ? [line.slice(7)] : []))
  if (!paths.length) throw new Error("Portable NSIS archive 文件路径为空")
  return {
    archive: { type: "Nsis", method: "Deflate", subtype: "NSIS-3 Unicode" } as const,
    entries: validateWindowsArchivePaths(paths),
  }
}

export function validateWindowsArchivePaths(
  listing: readonly string[],
  extracted?: readonly string[],
): WindowsArchivePath[] {
  const listed = requireWindowsArchivePathSet(listing, "listing")
  if (extracted === undefined) return listed
  const materialized = requireWindowsArchivePathSet(extracted, "提取树")
  if (listed.length !== materialized.length) {
    throw new Error(
      `Portable NSIS listing 与提取树数量不一一对应: listing=${listed.length} extracted=${materialized.length}`,
    )
  }
  const extractedByKey = new Map(materialized.map((entry) => [entry.windowsKey, entry]))
  const mismatch = listed.find((entry) => extractedByKey.get(entry.windowsKey)?.file !== entry.file)
  if (mismatch) {
    throw new Error(
      `Portable NSIS listing 与提取树路径不一一对应: listing=${JSON.stringify(listed)} extracted=${JSON.stringify(materialized)}`,
    )
  }
  return listed
}

function requireWindowsArchivePathSet(files: readonly string[], label: string) {
  const entries = files.map((file) => requireWindowsArchivePath(file, label))
  const keys = new Set<string>()
  for (const entry of entries) {
    if (keys.has(entry.windowsKey)) {
      throw new Error(`Portable NSIS ${label} 包含 Windows 等价重复路径: ${entry.file}`)
    }
    keys.add(entry.windowsKey)
  }
  return entries
}

function requireExactFiles(actual: readonly PayloadFile[], expected: readonly PayloadFile[], label: string) {
  const actualSorted = [...actual].sort((left, right) => left.file.localeCompare(right.file))
  const expectedSorted = [...expected].sort((left, right) => left.file.localeCompare(right.file))
  const mismatch = actualSorted.find((entry, index) => {
    const declared = expectedSorted[index]
    return !declared || entry.file !== declared.file || entry.size !== declared.size || entry.sha256 !== declared.sha256
  })
  if (mismatch || actualSorted.length !== expectedSorted.length) {
    throw new Error(`${label}不匹配: actual=${JSON.stringify(actualSorted)} expected=${JSON.stringify(expectedSorted)}`)
  }
}

function treeEvidence(files: readonly PayloadFile[]) {
  return { files: files.length, sha256: sha256(`${JSON.stringify(files)}\n`) }
}

async function runTool(executable: string, args: readonly string[]) {
  const child = Bun.spawn([executable, ...args], {
    cwd: path.dirname(executable),
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`锁定 7-Zip 只读提取失败 (${exitCode}): ${stderr.trim() || stdout.trim()}`)
  return stdout
}

function requireLockedBytes(content: Buffer, lock: LockedFile, label: string) {
  if (content.byteLength !== lock.size || sha256(content) !== lock.sha256) {
    throw new Error(`${label} size/SHA-256 与锁定证据不匹配`)
  }
}

async function requireConcreteFile(root: string, file: string, label: string) {
  const stats = await lstat(file)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} 必须是具体普通文件`)
  await verifyConcreteFile(root, file, sha256(await readFile(file)))
}

function requireWindowsArchivePath(file: string, label: string): WindowsArchivePath {
  if (typeof file !== "string" || /[\u0000-\u001f\u007f]/.test(file)) {
    throw new Error(`Portable NSIS ${label} 路径包含 NUL 或控制字符`)
  }
  if (/^[\\/]/.test(file) || /^[a-zA-Z]:/.test(file) || /^(?:\\\\|\/\/)/.test(file)) {
    throw new Error(`Portable NSIS ${label} 拒绝绝对、drive 或 UNC 路径: ${file}`)
  }
  const slashPath = file.replaceAll("\\", "/")
  const parts = slashPath.split("/")
  if (!slashPath || path.posix.isAbsolute(slashPath) || path.posix.normalize(slashPath) !== slashPath) {
    throw new Error(`Portable NSIS ${label} 路径越界或非规范: ${file}`)
  }
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error(`Portable NSIS ${label} 路径包含空段或 traversal: ${file}`)
    }
    if (/[ .]$/.test(part)) throw new Error(`Portable NSIS ${label} 路径段不得尾随点或空格: ${file}`)
    if (/[<>:"|?*]/.test(part)) throw new Error(`Portable NSIS ${label} 路径段包含 ADS 或 Windows 非法字符: ${file}`)
    const deviceStem = part.split(".", 1)[0]?.toUpperCase()
    if (/^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(deviceStem)) {
      throw new Error(`Portable NSIS ${label} 路径使用 Windows 保留设备名: ${file}`)
    }
  }
  return { file: slashPath, windowsKey: parts.map((part) => part.toLowerCase()).join("/") }
}

async function requireConcreteDirectory(root: string, label: string) {
  const stats = await lstat(root)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} 必须是具体目录`)
}

function slash(value: string) {
  return value.replaceAll("\\", "/")
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
