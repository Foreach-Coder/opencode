import { expect, test } from "bun:test"
import { resolveBrand } from "@opencode-ai/brand"
import config from "./electron.vite.config"

test("bundles the TypeScript brand workspace package into the Electron main process", () => {
  expect(config).toHaveProperty("main.build.externalizeDeps.exclude", ["@opencode-ai/brand"])
})

test("copies staged server assets into the staged main output", async () => {
  const source = await Bun.file(new URL("./electron.vite.config.ts", import.meta.url)).text()
  expect(source).toContain('path.join(productBuildStage ?? ".", "out", "main", "chunks", file)')
})

test("resolves the staged server jsonc dependency through its ESM entry", async () => {
  const resolver = config.main?.plugins?.find((plugin) => plugin?.name === "opencode:jsonc-parser-esm")
  expect(resolver).toBeTruthy()
  const resolveId = typeof resolver?.resolveId === "function" ? resolver.resolveId : resolver?.resolveId?.handler
  const resolved = await resolveId?.call({} as never, "jsonc-parser", "D:/stage/server/node.js", {} as never)
  expect(String(resolved).replaceAll("\\", "/")).toContain("jsonc-parser/lib/esm/main.js")
})

test("uses one build channel for the Electron main and renderer processes", () => {
  expect(config.renderer?.define?.["import.meta.env.VITE_OPENCODE_CHANNEL"]).toBe(
    config.main?.define?.["import.meta.env.OPENCODE_CHANNEL"],
  )
})

test("injects one resolved brand into main, preload, and renderer bundles", async () => {
  const previous = process.env.PRODUCT_BRAND_JSON
  const previousVisual = process.env.PRODUCT_VISUAL_JSON
  const previousStage = process.env.PRODUCT_BUILD_STAGE
  const brand = resolveBrand({ cli: { name: "FKGCODE", slug: "fkgcode", channel: "prod" } })
  process.env.PRODUCT_BRAND_JSON = JSON.stringify(brand)
  const visual = JSON.stringify({
    wordmarkSvg: '<svg viewBox="0 0 1 1"/>',
    appIconSvg: '<svg viewBox="0 0 1 1"/>',
    tuiWordmarkGrid: { width: 1, height: 1, cells: [[1]] },
  })
  process.env.PRODUCT_VISUAL_JSON = visual
  process.env.PRODUCT_BUILD_STAGE = "D:/product-build/fkgcode/prod"
  const injected = await import(`./electron.vite.config.ts?brand=${Date.now()}`)
  if (previous === undefined) delete process.env.PRODUCT_BRAND_JSON
  else process.env.PRODUCT_BRAND_JSON = previous
  if (previousVisual === undefined) delete process.env.PRODUCT_VISUAL_JSON
  else process.env.PRODUCT_VISUAL_JSON = previousVisual
  if (previousStage === undefined) delete process.env.PRODUCT_BUILD_STAGE
  else process.env.PRODUCT_BUILD_STAGE = previousStage

  const expected = JSON.stringify(JSON.stringify(brand))
  const expectedVisual = JSON.stringify(visual)
  expect(injected.default.main?.define?.PRODUCT_BRAND_JSON).toBe(expected)
  expect(injected.default.preload?.define?.PRODUCT_BRAND_JSON).toBe(expected)
  expect(injected.default.renderer?.define?.PRODUCT_BRAND_JSON).toBe(expected)
  expect(injected.default.main?.define?.PRODUCT_VISUAL_JSON).toBe(expectedVisual)
  expect(injected.default.preload?.define?.PRODUCT_VISUAL_JSON).toBe(expectedVisual)
  expect(injected.default.renderer?.define?.PRODUCT_VISUAL_JSON).toBe(expectedVisual)
  expect(injected.default.main?.build?.outDir).toBe("D:/product-build/fkgcode/prod/out/main")
  expect(injected.default.preload?.build?.outDir).toBe("D:/product-build/fkgcode/prod/out/preload")
  expect(injected.default.renderer?.build?.outDir).toBe("D:/product-build/fkgcode/prod/out/renderer")
  expect(injected.default.renderer?.publicDir).toBe("D:/product-build/fkgcode/prod/public")
  const title = injected.default.renderer?.plugins?.find((plugin) => plugin?.name === "opencode:product-title")
  expect(
    title?.transformIndexHtml?.(
      '<head><title>ForeachCode</title><link rel="icon" href="./favicon-v3.svg"><meta property="og:image" content="./social-share.png"></head>',
      {} as never,
    ),
  ).toBe('<head><title>FKGCODE</title>\n    <link rel="icon" type="image/svg+xml" href="./app-icon.svg" /></head>')
  expect(title?.transformIndexHtml?.("<title>A&B</title>", {} as never)).toContain("<title>FKGCODE</title>")
  const statics = injected.default.renderer?.plugins?.find(
    (plugin) => plugin?.name === "opencode:product-static-identity",
  )
  expect(
    statics?.transform?.(
      '{ "name": "ForeachCode", "id": "opencode" }',
      "D:/repo/packages/ui/src/theme/themes/opencode.json",
      {} as never,
    ),
  ).toContain('"name": "FKGCODE"')
  const writeBundle = injected.default.main?.plugins?.find((plugin) => plugin?.name === "opencode:copy-server-assets")
  expect(writeBundle).toBeTruthy()
  expect(JSON.stringify(injected.default)).not.toContain("process.env.PRODUCT_")
})
