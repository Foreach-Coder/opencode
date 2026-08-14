import { afterEach, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { build, type InlineConfig, type Plugin } from "vite"
import { resolveBrand } from "@opencode-ai/brand/config"

const temporary = path.join(import.meta.dir, ".brand-vite-test")

afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

test("injects the resolved brand into a real Enterprise bundle", async () => {
  const previousBrand = process.env.PRODUCT_BRAND_JSON
  const brand = resolveBrand({
    cli: { name: "FKGCODE", slug: "fkgcode", channel: "prod", disableProviderConnections: true },
  })
  process.env.PRODUCT_BRAND_JSON = JSON.stringify(brand)
  const config = (await import(`./vite.config.ts?brand=${Date.now()}`)).default as InlineConfig
  if (previousBrand === undefined) delete process.env.PRODUCT_BRAND_JSON
  else process.env.PRODUCT_BRAND_JSON = previousBrand

  expect(config.define?.PRODUCT_BRAND_JSON).toBe(JSON.stringify(JSON.stringify(brand)))
  const statics = config.plugins?.find(
    (plugin) => plugin && "name" in plugin && plugin.name === "opencode:product-static-identity",
  ) as Plugin | undefined
  const transform = typeof statics?.transform === "function" ? statics.transform : statics?.transform?.handler
  expect(
    transform?.call(
      {} as never,
      '{ "name": "ForeachCode", "id": "opencode" }',
      "D:/repo/packages/ui/src/theme/themes/opencode.json",
      {} as never,
    ),
  ).toContain('"name": "FKGCODE"')

  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary)
  await Bun.write(
    path.join(temporary, "entry.ts"),
    [
      'import { Brand } from "@opencode-ai/brand"',
      "console.log(Brand.name, Brand.slug, Brand.desktop.prod.appId)",
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
  expect(code).toContain("ai.fkgcode.desktop")
  expect(code).not.toContain("ForeachCode")
  expect(code).not.toContain("process.env.PRODUCT_")
  expect(code).not.toContain("import.meta.env.PRODUCT_")
})
