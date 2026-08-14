import { afterEach, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { build, type InlineConfig } from "vite"
import { resolveBrand } from "@opencode-ai/brand/config"

const temporary = path.join(import.meta.dir, ".brand-vite-test")

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

test("injects the resolved brand and visuals into a real standalone Web App bundle", async () => {
  const previousBrand = process.env.PRODUCT_BRAND_JSON
  const previousVisual = process.env.PRODUCT_VISUAL_JSON
  const brand = resolveBrand({
    cli: { name: "FKGCODE", slug: "fkgcode", channel: "prod", disableProviderConnections: true },
  })
  const visual = JSON.stringify({
    wordmarkSvg: '<svg viewBox="0 0 8 2"><title>FKG wordmark</title></svg>',
    appIconSvg: '<svg viewBox="0 0 2 2"><title>FKG icon</title></svg>',
    tuiWordmarkGrid: { width: 1, height: 1, cells: [[1]] },
  })
  process.env.PRODUCT_BRAND_JSON = JSON.stringify(brand)
  process.env.PRODUCT_VISUAL_JSON = visual
  const config = (await import(`./vite.config.ts?brand=${Date.now()}`)).default as InlineConfig
  restore("PRODUCT_BRAND_JSON", previousBrand)
  restore("PRODUCT_VISUAL_JSON", previousVisual)

  expect(config.define?.PRODUCT_BRAND_JSON).toBe(JSON.stringify(JSON.stringify(brand)))
  expect(config.define?.PRODUCT_VISUAL_JSON).toBe(JSON.stringify(visual))

  const identity = config.plugins?.find(
    (plugin) => plugin && "name" in plugin && plugin.name === "opencode:product-identity",
  )
  const html = await identity?.transformIndexHtml?.(
    '<head><title>ForeachCode</title><link rel="icon" href="/favicon-v3.svg"><link rel="manifest" href="/site.webmanifest"></head>',
    {} as never,
  )
  expect(html).toContain("<title>FKGCODE</title>")
  expect(html).toContain("data:image/svg+xml")
  expect(html).toContain("FKG%20icon")
  expect(html).not.toContain("favicon-v3.svg")
  expect(html).not.toContain("site.webmanifest")

  const statics = config.plugins?.find(
    (plugin) => plugin && "name" in plugin && plugin.name === "opencode:product-static-identity",
  )
  expect(
    statics?.transform?.(
      '{ "$schema": "https://opencode.ai/desktop-theme.json", "name": "ForeachCode", "id": "opencode" }',
      "D:/repo/packages/ui/src/theme/themes/opencode.json",
      {} as never,
    ),
  ).toContain('"name": "FKGCODE"')
  expect(
    statics?.transform?.(
      '{ "name": "ForeachCode", "id": "opencode" }',
      "D:/repo/packages/ui/src/theme/themes/opencode.json",
      {} as never,
    ),
  ).not.toContain("$1")
  await mkdir(temporary)
  await Bun.write(
    path.join(temporary, "entry.ts"),
    [
      'import { Brand } from "@opencode-ai/brand"',
      'import { VisualAssets } from "@opencode-ai/brand/assets"',
      "console.log(Brand.name, Brand.slug, VisualAssets.wordmark.svg, VisualAssets.appIcon.svg)",
    ].join("\n"),
  )
  const output = await build({
    configFile: false,
    logLevel: "silent",
    define: config.define,
    build: {
      write: false,
      minify: true,
      lib: { entry: path.join(temporary, "entry.ts"), formats: ["es"] },
    },
  })
  if (!Array.isArray(output) && !("output" in output)) throw new Error("Unexpected Vite watch result")
  const code = (Array.isArray(output) ? output : [output])
    .flatMap((item) => item.output)
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n")

  expect(code).toContain("FKGCODE")
  expect(code).toContain("fkgcode")
  expect(code).toContain("FKG wordmark")
  expect(code).toContain("FKG icon")
  expect(code).not.toContain("ForeachCode")
  expect(code).not.toContain("process.env.PRODUCT_")
  expect(code).not.toContain("import.meta.env.PRODUCT_")
})

test("fails when build brand or visuals are not supplied", async () => {
  const env = { ...process.env }
  delete env.PRODUCT_BRAND_JSON
  delete env.PRODUCT_VISUAL_JSON
  const result = Bun.spawnSync([process.execPath, "-e", 'await import("./vite.config.ts")'], {
    cwd: import.meta.dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain("PRODUCT_BRAND_JSON")
})

function restore(key: "PRODUCT_BRAND_JSON" | "PRODUCT_VISUAL_JSON", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
