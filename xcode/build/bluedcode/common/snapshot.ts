import { createHash } from "node:crypto"
import { readdir } from "node:fs/promises"
import path from "node:path"
import type { SnapshotManifest } from "./types"

const snapshotFiles = [
  "brand.json",
  "app-icon.svg",
  "app-icon.png",
  "wordmark.png",
  "wordmark.svg",
  "tui.json",
] as const
const permittedRootFiles = new Set(["snapshot-manifest.json", "build.ts", ...snapshotFiles])

export async function verifySnapshot(
  root: string,
  options: { includeFramework?: boolean } = {},
): Promise<SnapshotManifest> {
  const manifest = parseManifest(await Bun.file(path.join(root, "snapshot-manifest.json")).text())
  const expected = options.includeFramework ? await frameworkFiles(root) : [...snapshotFiles]
  const names = Object.keys(manifest.files).sort()
  if (
    options.includeFramework &&
    (names.length !== expected.length || names.some((name, index) => name !== expected[index]))
  )
    throw new Error("snapshot-manifest.json 包含缺失或多余文件")

  const entries = await readdir(root, { withFileTypes: true })
  const extraFiles = entries.filter((entry) => entry.isFile() && !permittedRootFiles.has(entry.name))
  if (extraFiles.length) throw new Error(`快照包含多余文件: ${extraFiles.map((entry) => entry.name).join(", ")}`)

  await Promise.all(
    expected.map(async (file) => {
      const source = Bun.file(path.join(root, file))
      if (!(await source.exists())) throw new Error(`快照缺失文件: ${file}`)
      const content = await source.arrayBuffer()
      if (content.byteLength === 0) throw new Error(`快照缺失文件: ${file}`)
      const actual = createHash("sha256").update(new Uint8Array(content)).digest("hex")
      if (actual !== manifest.files[file]) throw new Error(`快照文件 ${file} 的 SHA-256 不匹配`)
    }),
  )
  return manifest
}

function parseManifest(content: string): SnapshotManifest {
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== "object" || !("frameworkVersion" in parsed) || !("files" in parsed)) {
    throw new Error("snapshot-manifest.json 无效")
  }
  if (
    parsed.frameworkVersion !== 1 ||
    !parsed.files ||
    typeof parsed.files !== "object" ||
    Array.isArray(parsed.files)
  ) {
    throw new Error("snapshot-manifest.json 无效")
  }
  for (const [file, hash] of Object.entries(parsed.files)) {
    if (!isSnapshotPath(file) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("snapshot-manifest.json 无效")
    }
  }
  return parsed as SnapshotManifest
}

async function frameworkFiles(root: string) {
  const files: string[] = []
  await visit(root, "")
  return files.sort((left, right) => left.localeCompare(right))

  async function visit(directory: string, relative: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "snapshot-manifest.json" || entry.name === "test" || entry.name === "tests") continue
      const child = path.join(directory, entry.name)
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`快照拒绝符号链接: ${file}`)
      if (entry.isDirectory()) {
        await visit(child, file)
        continue
      }
      if (!entry.isFile()) throw new Error(`快照拒绝非普通文件: ${file}`)
      files.push(file)
    }
  }
}

function isSnapshotPath(file: string) {
  return (
    file === "build.ts" ||
    snapshotFiles.includes(file as (typeof snapshotFiles)[number]) ||
    /^(?:common|tools|version)\/.+\.(?:json|ts)$/.test(file)
  )
}
