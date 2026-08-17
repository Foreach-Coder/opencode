import { expect, test } from "bun:test"
import { cp, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { verifySnapshot } from "../common/snapshot"

const snapshotRoot = path.resolve(import.meta.dir, "..")
const parentResourceRoot = path.resolve(snapshotRoot, "../../../../xcode/build/bluedcode")

async function temporarySnapshot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-snapshot-"))
  await Promise.all(
    ["brand.json", "app-icon.svg", "app-icon.png", "wordmark.svg", "tui.json", "snapshot-manifest.json"].map((file) =>
      cp(path.join(snapshotRoot, file), path.join(root, file)),
    ),
  )
  return root
}

async function pathExists(target: string) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = relative ? path.posix.join(relative, entry.name) : entry.name
      if (entry.isDirectory()) return listFiles(root, child)
      if (entry.isFile()) return [child]
      return []
    }),
  )
  return files.flat().sort((left, right) => left.localeCompare(right))
}

test("验证子仓快照而不访问父仓", async () => {
  await expect(verifySnapshot(snapshotRoot)).resolves.toMatchObject({
    frameworkVersion: 1,
    files: {
      "brand.json": expect.stringMatching(/^[a-f0-9]{64}$/),
      "app-icon.svg": expect.stringMatching(/^[a-f0-9]{64}$/),
      "app-icon.png": expect.stringMatching(/^[a-f0-9]{64}$/),
      "wordmark.svg": expect.stringMatching(/^[a-f0-9]{64}$/),
      "tui.json": expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  })
})

test("根仓与子仓框架快照覆盖全部公开框架文件", async () => {
  const manifest = await verifySnapshot(snapshotRoot, { includeFramework: true })
  expect(manifest.files["common/build.ts"]).toMatch(/^[a-f0-9]{64}$/)
  expect(manifest.files["tools/adapter-diff.ts"]).toMatch(/^[a-f0-9]{64}$/)
  expect(manifest.files["brand.json"]).toMatch(/^[a-f0-9]{64}$/)
  expect(Object.values(manifest.files).every((sha256) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true)
})

test("父级根仓 BluedCode 资源目录只能保留静态品牌资源", async () => {
  if (!(await pathExists(parentResourceRoot))) return

  const files = await listFiles(parentResourceRoot)
  const forbidden = files.filter((file) => {
    const normalized = file.replaceAll("\\", "/")
    return (
      normalized.startsWith("common/") ||
      normalized.startsWith("tools/") ||
      normalized.endsWith(".ts") ||
      normalized.endsWith(".js") ||
      normalized === "snapshot-manifest.json" ||
      normalized === "tui.json"
    )
  })

  expect(forbidden).toEqual([])
  expect(files).toEqual(["app-icon.png", "app-icon.svg", "brand.json", "resource-manifest.json", "wordmark.svg"])
})

test("拒绝删除快照文件", async () => {
  const root = await temporarySnapshot()
  try {
    await rm(path.join(root, "wordmark.svg"))
    await expect(verifySnapshot(root)).rejects.toThrow("缺失")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("拒绝额外快照文件", async () => {
  const root = await temporarySnapshot()
  try {
    await writeFile(path.join(root, "unexpected.json"), "{}")
    await expect(verifySnapshot(root)).rejects.toThrow("多余")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("拒绝内容哈希变化", async () => {
  const root = await temporarySnapshot()
  try {
    await writeFile(path.join(root, "brand.json"), "{}")
    await expect(verifySnapshot(root)).rejects.toThrow("SHA-256")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
