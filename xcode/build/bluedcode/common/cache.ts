import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import type { BuildIdentity } from "./types"

export type CacheKeyInput = {
  unit: string
  identity: BuildIdentity
  commit: string
  bunLockDigest: string
  bunVersion: string
  electronVersion: string
  platform: "win32"
  arch: "x64"
  frameworkDigest: string
  adapterDigest: string
  inputDigest: string
  identitySensitive?: boolean
}

export type CacheResult<T> = {
  hit: boolean
  value: T
  directory: string
}

export type CacheIsolation = {
  lexicalRoot: string
  canonicalRoot: string
}

export function cacheKey(input: CacheKeyInput) {
  const identitySensitive = input.identitySensitive ?? input.unit !== "server"
  const payload = {
    schema: 1,
    unit: input.unit,
    commit: input.commit,
    bunLockDigest: input.bunLockDigest,
    bunVersion: input.bunVersion,
    electronVersion: input.electronVersion,
    platform: input.platform,
    arch: input.arch,
    frameworkDigest: input.frameworkDigest,
    adapterDigest: input.adapterDigest,
    inputDigest: input.inputDigest,
    identity: identitySensitive
      ? {
          channel: input.identity.channel,
          name: input.identity.name,
          appId: input.identity.appId,
          protocol: input.identity.protocol,
          version: input.identity.version,
          commit: input.identity.commit,
          shortCommit: input.identity.shortCommit,
          artifactName: input.identity.artifactName,
          tag: input.identity.tag,
        }
      : undefined,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export async function withCache<T>(
  unit: string,
  key: string,
  build: (directory: string) => Promise<T>,
  isolation: CacheIsolation,
): Promise<CacheResult<T>> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("缓存键必须是 64 位小写 SHA-256")
  const trusted = await requireCacheIsolation(isolation)
  const unitRoot = path.resolve(unit)
  await ensureCacheDirectory(trusted, unitRoot)
  const directory = path.join(unitRoot, key)
  await assertOptionalCacheDirectory(trusted, directory)
  const cached = await readCached<T>(trusted.canonicalRoot, directory)
  if (cached !== undefined) return { hit: true, value: cached, directory }

  const temporary = path.join(path.dirname(directory), `.tmp-${key}-${process.pid}-${crypto.randomUUID()}`)
  await mkdir(temporary)
  await assertCacheDirectory(trusted, temporary)
  try {
    const value = await build(temporary)
    await assertCacheDirectory(trusted, temporary)
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error("缓存值必须可序列化为 JSON")
    await writeFile(path.join(temporary, "result.json"), serialized, { flag: "wx" })
    await assertCacheDirectory(trusted, temporary)
    await rename(temporary, directory)
    await assertCacheDirectory(trusted, directory)
    return { hit: false, value, directory }
  } catch (error) {
    await removeCacheDirectory(trusted, temporary)
    await assertOptionalCacheDirectory(trusted, directory)
    const winner = await readCached<T>(trusted.canonicalRoot, directory)
    if (winner !== undefined) return { hit: true, value: winner, directory }
    throw error
  }
}

async function readCached<T>(canonicalUnit: string, directory: string): Promise<T | undefined> {
  const manifest = path.join(directory, "result.json")
  if (!(await pathExists(manifest))) return undefined
  const stats = await lstat(manifest)
  if (stats.isSymbolicLink()) throw new Error(`缓存 manifest 拒绝符号链接、junction 或 reparse point: ${manifest}`)
  if (!stats.isFile()) throw new Error(`缓存 manifest 不是普通文件: ${manifest}`)
  const canonicalManifest = await realpath(manifest)
  const relative = path.relative(canonicalUnit, canonicalManifest)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`缓存 manifest canonical 路径越界: ${manifest}`)
  }
  const parsed: unknown = JSON.parse(await readFile(manifest, "utf8"))
  // Generic persistent caches require the caller to keep T JSON-compatible across builds.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return parsed as T
}

async function removeCacheDirectory(isolation: CacheIsolation, directory: string) {
  if (!(await pathExists(directory))) return
  await assertCacheDirectory(isolation, directory)
  await rm(directory, { recursive: true })
}

async function assertOptionalCacheDirectory(isolation: CacheIsolation, directory: string) {
  if (!(await pathExists(directory))) return
  await assertCacheDirectory(isolation, directory)
}

async function assertCacheDirectory(isolation: CacheIsolation, directory: string) {
  requireCacheDescendant(isolation.lexicalRoot, directory)
  const stats = await lstat(directory)
  if (stats.isSymbolicLink()) throw new Error(`缓存目录拒绝符号链接、junction 或 reparse point: ${directory}`)
  if (!stats.isDirectory()) throw new Error(`缓存路径不是目录: ${directory}`)
  const canonical = await realpath(directory)
  if (!isDescendantOrSelf(isolation.canonicalRoot, canonical)) {
    throw new Error(`缓存 canonical 路径越界: ${directory}`)
  }
}

async function requireCacheIsolation(isolation: CacheIsolation): Promise<CacheIsolation> {
  const lexicalRoot = path.resolve(isolation.lexicalRoot)
  const canonicalRoot = path.resolve(isolation.canonicalRoot)
  const stats = await lstat(lexicalRoot)
  if (stats.isSymbolicLink())
    throw new Error(`缓存 trusted root 拒绝符号链接、junction 或 reparse point: ${lexicalRoot}`)
  if (!stats.isDirectory()) throw new Error(`缓存 trusted root 不是目录: ${lexicalRoot}`)
  if (path.relative(canonicalRoot, await realpath(lexicalRoot)) !== "") {
    throw new Error("缓存 trusted root capability 与 canonical 路径不匹配")
  }
  return { lexicalRoot, canonicalRoot }
}

async function ensureCacheDirectory(isolation: CacheIsolation, directory: string) {
  const relative = requireCacheDescendant(isolation.lexicalRoot, directory)
  let current = isolation.lexicalRoot
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const existing = await lstatOptional(current)
    if (!existing) {
      try {
        await mkdir(current)
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error
      }
    }
    await assertCacheDirectory(isolation, current)
  }
}

function requireCacheDescendant(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`缓存路径越出 trusted root: ${target}`)
  }
  return relative
}

function isDescendantOrSelf(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function pathExists(target: string) {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
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
