import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadModelsSnapshot } from "../script/models-snapshot"

describe("build models snapshot", () => {
  test("product builds use the offline snapshot before the normal development fallback", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "../script/generate.ts")).text()
    expect(source).toContain("process.env.PRODUCT_BUILD_STAGE")
    expect(source.indexOf("loadModelsSnapshot")).toBeLessThan(source.indexOf("fetch("))
  })

  test("loads an explicit local JSON snapshot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "models-snapshot-"))
    const source = path.join(directory, "models.json")
    await Bun.write(source, '{"provider":{}}')
    expect(await loadModelsSnapshot(source)).toBe('{"provider":{}}')
    await rm(directory, { recursive: true, force: true })
  })

  test("rejects a missing or invalid snapshot instead of fetching models.dev", async () => {
    await expect(loadModelsSnapshot("missing-models-snapshot.json")).rejects.toThrow("does not exist")
    const directory = await mkdtemp(path.join(os.tmpdir(), "models-snapshot-"))
    const source = path.join(directory, "models.json")
    await Bun.write(source, "not json")
    await expect(loadModelsSnapshot(source)).rejects.toThrow("valid JSON object")
    await rm(directory, { recursive: true, force: true })
  })
})
