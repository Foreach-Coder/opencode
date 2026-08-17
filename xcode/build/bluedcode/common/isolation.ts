import { createHash } from "node:crypto"
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises"
import path from "node:path"
import type { CacheIsolation } from "./cache"
import type { BuildPaths } from "./paths"

export async function prepareIsolation(paths: Pick<BuildPaths, "repositoryRoot" | "outputRoot">) {
  const lexicalRepositoryRoot = path.resolve(paths.repositoryRoot)
  const lexicalOutputRoot = path.join(lexicalRepositoryRoot, ".xcode", "bluedcode")
  if (path.relative(lexicalOutputRoot, path.resolve(paths.outputRoot)) !== "") {
    throw new Error("构建输出根必须是仓库 .xcode/bluedcode 隔离目录")
  }
  const canonicalRepositoryRoot = await realpath(lexicalRepositoryRoot)
  await ensureDirectoryChain(lexicalRepositoryRoot, canonicalRepositoryRoot, lexicalOutputRoot)
  const canonicalRoot = await realpath(lexicalOutputRoot)
  if (path.relative(path.join(canonicalRepositoryRoot, ".xcode", "bluedcode"), canonicalRoot) !== "") {
    throw new Error(".xcode/bluedcode canonical 路径越出仓库")
  }
  return { canonicalRoot, lexicalRoot: lexicalOutputRoot }
}

export async function ensureSafeDirectory(isolation: CacheIsolation, target: string) {
  await inspectDirectoryChain(isolation.lexicalRoot, isolation.canonicalRoot, target, true)
}

export async function assertSafeDirectory(isolation: CacheIsolation, target: string) {
  await inspectDirectoryChain(isolation.lexicalRoot, isolation.canonicalRoot, target, false)
}

export async function assertOptionalSafeDirectory(isolation: CacheIsolation, target: string) {
  if (!(await pathExists(target))) return
  await assertSafeDirectory(isolation, target)
}

export async function assertConcreteDirectory(root: string, directory: string) {
  const lexicalRoot = path.resolve(root)
  const canonicalRoot = await requireConcreteRoot(lexicalRoot)
  const relative = requireStrictDescendant(lexicalRoot, directory)
  let current = lexicalRoot
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stats = await lstat(current)
    if (stats.isSymbolicLink()) throw new Error(`具体目录拒绝符号链接、junction 或 reparse point: ${current}`)
    if (!stats.isDirectory()) throw new Error(`具体路径不是目录: ${current}`)
    const canonical = await realpath(current)
    if (!isStrictDescendant(canonicalRoot, canonical)) throw new Error(`具体目录 canonical 路径越界: ${current}`)
  }
}

export async function verifyConcreteFile(root: string, file: string, expectedDigest: string) {
  const lexicalRoot = path.resolve(root)
  const canonicalRoot = await requireConcreteRoot(lexicalRoot)
  const relative = requireStrictDescendant(lexicalRoot, file)
  const parts = relative.split(path.sep)
  let current = lexicalRoot
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part)
    const stats = await lstat(current)
    if (stats.isSymbolicLink()) throw new Error(`具体文件父目录拒绝符号链接、junction 或 reparse point: ${current}`)
    if (!stats.isDirectory()) throw new Error(`具体文件父路径不是目录: ${current}`)
    const canonical = await realpath(current)
    if (!isStrictDescendant(canonicalRoot, canonical)) {
      throw new Error(`具体文件父目录 canonical 路径越界: ${current}`)
    }
  }
  const stats = await lstat(file)
  if (stats.isSymbolicLink()) throw new Error(`具体文件拒绝符号链接、junction 或 reparse point: ${file}`)
  if (!stats.isFile()) throw new Error(`具体产物不是普通文件: ${file}`)
  const canonical = await realpath(file)
  if (!isStrictDescendant(canonicalRoot, canonical)) throw new Error(`具体文件 canonical 路径越界: ${file}`)
  const actual = createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
  if (actual !== expectedDigest) throw new Error(`具体产物摘要不匹配: ${file}`)
  return file
}

export async function removeSafeDirectory(isolation: CacheIsolation, directory: string) {
  await assertSafeDirectory(isolation, directory)
  await rm(directory, { recursive: true })
}

export async function publishImmutableFile(
  isolation: CacheIsolation,
  root: string,
  target: string,
  content: string | Uint8Array,
  expectedDigest: string,
) {
  const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content)
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new Error("不可变文件声明摘要与内容不匹配")
  }
  await assertSafeDirectory(isolation, root)
  await assertConcreteDirectory(isolation.lexicalRoot, root)
  requireStrictDescendant(root, target)
  const parent = path.dirname(target)
  await assertSafeDirectory(isolation, parent)
  if (path.resolve(parent) !== path.resolve(root)) await assertConcreteDirectory(root, parent)
  if (await lstatOptional(target)) {
    await verifyImmutableContent(root, target, bytes, expectedDigest)
    return target
  }

  const temporary = path.join(parent, `.tmp-${path.basename(target)}-${process.pid}-${crypto.randomUUID()}`)
  const handle = await open(temporary, "wx")
  try {
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await verifyImmutableContent(root, temporary, bytes, expectedDigest)
    try {
      await rename(temporary, target)
    } catch (error) {
      if (!(await lstatOptional(target))) throw error
      await verifyImmutableContent(root, target, bytes, expectedDigest)
      await removeConcreteTemporary(root, temporary)
      return target
    }
    await verifyImmutableContent(root, target, bytes, expectedDigest)
    return target
  } catch (error) {
    if (await lstatOptional(temporary)) await removeConcreteTemporary(root, temporary)
    throw error
  }
}

async function verifyImmutableContent(root: string, file: string, content: Buffer, expectedDigest: string) {
  await verifyConcreteFile(root, file, expectedDigest)
  if (!(await readFile(file)).equals(content)) throw new Error(`不可变文件内容冲突: ${file}`)
}

async function removeConcreteTemporary(root: string, file: string) {
  const stats = await lstat(file)
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`临时文件不是具体普通文件: ${file}`)
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
  await verifyConcreteFile(root, file, digest)
  await unlink(file)
}

async function ensureDirectoryChain(lexicalRoot: string, canonicalRoot: string, target: string) {
  await inspectDirectoryChain(lexicalRoot, canonicalRoot, target, true)
}

async function inspectDirectoryChain(lexicalRoot: string, canonicalRoot: string, target: string, create: boolean) {
  const relative = requireDescendantOrSelf(lexicalRoot, target)
  if (!relative) return
  let current = lexicalRoot
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const existing = await lstatOptional(current)
    if (!existing && !create) throw new Error(`隔离目录不存在: ${current}`)
    if (!existing) {
      try {
        await mkdir(current)
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error
      }
    }
    const stats = existing ?? (await lstat(current))
    if (stats.isSymbolicLink()) throw new Error(`隔离目录拒绝符号链接、junction 或 reparse point: ${current}`)
    if (!stats.isDirectory()) throw new Error(`隔离路径不是目录: ${current}`)
    const canonical = await realpath(current)
    if (!isDescendantOrSelf(canonicalRoot, canonical)) throw new Error(`隔离目录 canonical 路径越界: ${current}`)
  }
}

function requireDescendantOrSelf(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`隔离路径越界: ${target}`)
  }
  return relative
}

function isDescendantOrSelf(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function requireConcreteRoot(root: string) {
  const stats = await lstat(root)
  if (stats.isSymbolicLink()) throw new Error(`具体 trusted root 拒绝符号链接、junction 或 reparse point: ${root}`)
  if (!stats.isDirectory()) throw new Error(`具体 trusted root 不是目录: ${root}`)
  return realpath(root)
}

function requireStrictDescendant(root: string, target: string) {
  const relative = requireDescendantOrSelf(root, target)
  if (!relative) throw new Error(`具体路径必须是 trusted root 的严格后代: ${target}`)
  return relative
}

function isStrictDescendant(root: string, target: string) {
  const relative = path.relative(root, target)
  return Boolean(relative) && isDescendantOrSelf(root, target)
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
