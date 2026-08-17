import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { auditDistributionZip, createDistributionZip, extractDistributionZip } from "../common/distribution-zip"

test("zip 目录包固定顶层目录并与 win-unpacked 载荷逐项一致", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-zip-"))
  try {
    const sourceRoot = path.join(root, "win-unpacked")
    const zipFile = path.join(root, "BluedCode-1.18.18-260816-01-0123456789-windows-x64.zip")
    await writeFixture(path.join(sourceRoot, "BluedCode.exe"), "exe")
    await writeFixture(path.join(sourceRoot, "resources", "app.asar"), "asar")

    const result = await createDistributionZip({
      sourceRoot,
      topLevelDirectory: "BluedCode-1.18.18-260816-01-0123456789",
      zipFile,
    })
    const extracted = await extractDistributionZip({
      zipFile,
      targetRoot: path.join(root, "extract"),
      topLevelDirectory: "BluedCode-1.18.18-260816-01-0123456789",
    })

    expect(result.artifact.size).toBeGreaterThan(0)
    expect(result.artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.audit.topLevelDirectory).toBe("BluedCode-1.18.18-260816-01-0123456789")
    expect(result.audit.entries).toEqual([
      "BluedCode-1.18.18-260816-01-0123456789/BluedCode.exe",
      "BluedCode-1.18.18-260816-01-0123456789/resources/app.asar",
    ])
    expect(result.audit.sourceTree).toEqual(result.audit.zipTree)
    expect(await readFile(path.join(extracted, "resources", "app.asar"), "utf8")).toBe("asar")
    expect(
      await auditDistributionZip({
        sourceRoot,
        topLevelDirectory: "BluedCode-1.18.18-260816-01-0123456789",
        zipFile,
      }),
    ).toEqual(result.audit)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("zip 目录包拒绝错误顶层目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-zip-invalid-"))
  try {
    const sourceRoot = path.join(root, "win-unpacked")
    await writeFixture(path.join(sourceRoot, "BluedCode.exe"), "exe")
    await expect(
      createDistributionZip({
        sourceRoot,
        topLevelDirectory: "BluedCode",
        zipFile: path.join(root, "invalid.zip"),
      }),
    ).rejects.toThrow(/顶层目录/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeFixture(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}
