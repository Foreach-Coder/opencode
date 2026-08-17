import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { deflateRawSync, inflateRawSync } from "node:zlib"

export type DistributionZipAudit = {
  topLevelDirectory: string
  entries: string[]
  sourceTree: { files: number; sha256: string }
  zipTree: { files: number; sha256: string }
  passed: true
}

type ZipEntry = {
  file: string
  data: Buffer
}

export async function createDistributionZip(input: { sourceRoot: string; topLevelDirectory: string; zipFile: string }) {
  requireTopLevelDirectory(input.topLevelDirectory)
  const files = await listConcreteFiles(input.sourceRoot)
  const entries = await Promise.all(
    files.map(async (file) => ({
      file: `${input.topLevelDirectory}/${file}`,
      data: await readFile(path.join(input.sourceRoot, ...file.split("/"))),
    })),
  )
  const zip = writeZip(entries)
  await writeFile(input.zipFile, zip)
  const audit = await auditDistributionZip({
    sourceRoot: input.sourceRoot,
    topLevelDirectory: input.topLevelDirectory,
    zipFile: input.zipFile,
  })
  return {
    artifact: {
      size: zip.byteLength,
      sha256: sha256(zip),
    },
    audit,
  }
}

export async function auditDistributionZip(input: {
  sourceRoot: string
  topLevelDirectory: string
  zipFile: string
}): Promise<DistributionZipAudit> {
  requireTopLevelDirectory(input.topLevelDirectory)
  const sourceFiles = await listConcreteFiles(input.sourceRoot)
  const sourceEntries = await Promise.all(
    sourceFiles.map(async (file) => ({ file, data: await readFile(path.join(input.sourceRoot, ...file.split("/"))) })),
  )
  const zipEntries = readZip(await readFile(input.zipFile)).map((entry) => {
    if (!entry.file.startsWith(`${input.topLevelDirectory}/`)) throw new Error("zip 入口未位于指定顶层目录")
    return { file: entry.file.slice(input.topLevelDirectory.length + 1), data: entry.data }
  })
  const sourceTree = digestEntries(sourceEntries)
  const zipTree = digestEntries(zipEntries)
  if (
    sourceTree.files !== zipTree.files ||
    sourceTree.sha256 !== zipTree.sha256 ||
    JSON.stringify(sourceEntries.map((entry) => entry.file)) !== JSON.stringify(zipEntries.map((entry) => entry.file))
  ) {
    throw new Error("zip 目录载荷与 win-unpacked 不一致")
  }
  return {
    topLevelDirectory: input.topLevelDirectory,
    entries: zipEntries.map((entry) => `${input.topLevelDirectory}/${entry.file}`),
    sourceTree,
    zipTree,
    passed: true,
  }
}

export async function extractDistributionZip(input: {
  zipFile: string
  targetRoot: string
  topLevelDirectory: string
}) {
  requireTopLevelDirectory(input.topLevelDirectory)
  const entries = readZip(await readFile(input.zipFile))
  for (const entry of entries) {
    if (!entry.file.startsWith(`${input.topLevelDirectory}/`)) throw new Error("zip 解压入口未位于指定顶层目录")
    const relative = requireRelativeFile(entry.file)
    const target = path.join(input.targetRoot, ...relative.split("/"))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, entry.data)
  }
  return path.join(input.targetRoot, input.topLevelDirectory)
}

function writeZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries.sort((left, right) => left.file.localeCompare(right.file))) {
    const name = Buffer.from(requireRelativeFile(entry.file), "utf8")
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(33, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(entry.data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(entry.data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.byteLength + name.byteLength + compressed.byteLength
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function readZip(zip: Buffer): ZipEntry[] {
  const end = findEndOfCentralDirectory(zip)
  const count = readUInt16LE(zip, end + 10)
  const size = readUInt32LE(zip, end + 12)
  const offset = readUInt32LE(zip, end + 16)
  if (offset + size > end) throw new Error("zip central directory 越界")
  const entries: ZipEntry[] = []
  let cursor = offset
  for (let index = 0; index < count; index++) {
    if (readUInt32LE(zip, cursor) !== 0x02014b50) throw new Error("zip central directory 结构无效")
    const method = readUInt16LE(zip, cursor + 10)
    const crc = readUInt32LE(zip, cursor + 16)
    const compressedSize = readUInt32LE(zip, cursor + 20)
    const uncompressedSize = readUInt32LE(zip, cursor + 24)
    const nameLength = readUInt16LE(zip, cursor + 28)
    const extraLength = readUInt16LE(zip, cursor + 30)
    const commentLength = readUInt16LE(zip, cursor + 32)
    const localOffset = readUInt32LE(zip, cursor + 42)
    const file = requireRelativeFile(new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength)))
    const data = readLocalEntry(zip, localOffset, method, compressedSize, uncompressedSize)
    if (crc32(data) !== crc) throw new Error(`zip CRC 不匹配: ${file}`)
    entries.push({ file, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (new Set(entries.map((entry) => entry.file.toLowerCase())).size !== entries.length) {
    throw new Error("zip 入口存在 Windows 等价重复路径")
  }
  return entries.sort((left, right) => left.file.localeCompare(right.file))
}

function readLocalEntry(zip: Buffer, offset: number, method: number, compressedSize: number, uncompressedSize: number) {
  if (readUInt32LE(zip, offset) !== 0x04034b50) throw new Error("zip local header 结构无效")
  const nameLength = readUInt16LE(zip, offset + 26)
  const extraLength = readUInt16LE(zip, offset + 28)
  const start = offset + 30 + nameLength + extraLength
  const compressed = zip.subarray(start, start + compressedSize)
  const data = method === 8 ? inflateRawSync(compressed) : method === 0 ? compressed : undefined
  if (!data) throw new Error(`zip 不支持的压缩方法: ${method}`)
  if (data.byteLength !== uncompressedSize) throw new Error("zip 解压大小不匹配")
  return Buffer.from(data)
}

function findEndOfCentralDirectory(zip: Buffer) {
  for (let index = zip.byteLength - 22; index >= 0; index--) {
    if (readUInt32LE(zip, index) === 0x06054b50) return index
  }
  throw new Error("zip 缺少 central directory")
}

function readUInt16LE(buffer: Buffer, offset: number) {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 2).getUint16(0, true)
}

function readUInt32LE(buffer: Buffer, offset: number) {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, true)
}

async function listConcreteFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort((left, right) => left.localeCompare(right))

  async function visit(directory: string, relative: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`zip 目录拒绝链接: ${child}`)
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), child)
        continue
      }
      if (!entry.isFile()) throw new Error(`zip 目录拒绝非普通文件: ${child}`)
      const stats = await lstat(path.join(directory, entry.name))
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`zip 目录拒绝非具体文件: ${child}`)
      files.push(requireRelativeFile(child))
    }
  }
}

function digestEntries(entries: readonly ZipEntry[]) {
  const hash = createHash("sha256")
  for (const entry of [...entries].sort((left, right) => left.file.localeCompare(right.file))) {
    hash.update(entry.file).update("\0").update(entry.data).update("\0")
  }
  return { files: entries.length, sha256: hash.digest("hex") }
}

function requireTopLevelDirectory(value: string) {
  if (!/^BluedCode(?:-Dev)?-\d+\.\d+\.\d+(?:-(?:dev-[a-f0-9]{10}|\d{6}-\d{2}-[a-f0-9]{10}))$/.test(value)) {
    throw new Error("zip 顶层目录名无效")
  }
  requireRelativeFile(value)
}

function requireRelativeFile(value: string) {
  const normalized = value.replaceAll("\\", "/")
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === ".." || /[:\0-\x1f]/.test(part))
  ) {
    throw new Error(`zip 路径无效: ${value}`)
  }
  return normalized
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
