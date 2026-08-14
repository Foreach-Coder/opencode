import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveBrand } from "@opencode-ai/brand/config"
import { createProductCompileDefinitions, resolveCliBuildConfig, resolveCliArtifact } from "../script/build-config"

const brand = resolveBrand({
  cli: { name: "FKGCODE", slug: "fkgcode", channel: "prod", disableProviderConnections: true },
})
const visual = JSON.stringify({
  tuiWordmarkGrid: { width: 2, height: 1, cells: [[1, 0]] },
})

describe("standalone CLI product build", () => {
  test("build script writes through the isolated artifact contract", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "../script/build.ts")).text()

    expect(source).toContain("await $`rm -rf ${config.outputRoot}`")
    expect(source).toContain("outfile: artifact.binary")
    expect(source).toContain("...createProductCompileDefinitions(config.brandPayload, config.visualPayload)")
    expect(source).not.toContain("await $`rm -rf dist`")
  })

  test("uses the injected brand and an isolated single-platform staging directory", () => {
    const stage = path.resolve("dist/product-build/fkgcode/prod")
    const config = resolveCliBuildConfig({
      directory: path.resolve("packages/opencode"),
      stage,
      brandPayload: JSON.stringify(brand),
      visualPayload: visual,
      single: false,
      skipInstall: false,
      skipEmbedWebUi: false,
    })

    expect(config.brand).toEqual(brand)
    expect(config.outputRoot).toBe(path.join(stage, "cli"))
    expect(config.single).toBe(true)
    expect(config.skipInstall).toBe(true)
    expect(config.skipEmbedWebUi).toBe(true)
  })

  test("rejects a product stage outside the repository build root", () => {
    expect(() =>
      resolveCliBuildConfig({
        directory: path.resolve("packages/opencode"),
        stage: path.resolve("outside-product-build"),
        brandPayload: JSON.stringify(brand),
        visualPayload: visual,
        single: true,
        skipInstall: true,
        skipEmbedWebUi: true,
      }),
    ).toThrow("Unsafe product CLI staging path")
  })

  test("names the staged artifact and executable from the product slug", () => {
    const stage = path.resolve("dist/product-build/fkgcode/prod")
    const config = resolveCliBuildConfig({
      directory: path.resolve("packages/opencode"),
      stage,
      brandPayload: JSON.stringify(brand),
      visualPayload: visual,
      single: true,
      skipInstall: true,
      skipEmbedWebUi: true,
    })
    const artifact = resolveCliArtifact(config, { os: "win32", arch: "x64" })

    expect(artifact.name).toBe("fkgcode")
    expect(artifact.directory).toBe(path.join(stage, "cli"))
    expect(artifact.binary).toBe(path.join(stage, "cli", "fkgcode.exe"))
    expect(artifact.manifest).toBe(path.join(stage, "cli", "package.json"))
  })

  test("injects the same resolved brand and visual payload into the binary", () => {
    expect(createProductCompileDefinitions(JSON.stringify(brand), visual)).toEqual({
      PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify(brand)),
      PRODUCT_VISUAL_JSON: JSON.stringify(visual),
    })
  })

  test("rejects an unbranded development build instead of using a source fallback", () => {
    const directory = path.resolve("packages/opencode")
    expect(() =>
      resolveCliBuildConfig({
        directory,
        single: false,
        skipInstall: false,
        skipEmbedWebUi: false,
      }),
    ).toThrow("PRODUCT_BRAND_JSON")
  })
})
