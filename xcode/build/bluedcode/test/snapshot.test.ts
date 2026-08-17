import { expect, test } from "bun:test"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { verifySnapshot } from "../common/snapshot"

const snapshotRoot = path.resolve(import.meta.dir, "..")

async function temporarySnapshot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-snapshot-"))
  await Promise.all(
    ["brand.json", "app-icon.svg", "app-icon.png", "wordmark.svg", "tui.json", "snapshot-manifest.json"].map((file) =>
      cp(path.join(snapshotRoot, file), path.join(root, file)),
    ),
  )
  return root
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
  expect(manifest.files["brand.json"]).toMatch(/^[a-f0-9]{64}$/)
  expect(Object.values(manifest.files).every((sha256) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true)
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
