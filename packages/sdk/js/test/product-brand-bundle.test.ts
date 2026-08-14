import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("non-default product bundle excludes the default runtime identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-product-brand-"))
  const output = path.join(directory, "out")
  const entrypoint = path.join(directory, "entry.ts")
  await Bun.write(
    entrypoint,
    `export { PRODUCT_NAME, PRODUCT_CLI, SERVER_READY_PREFIX } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/brand.gen.ts"))}`,
  )
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: output,
    target: "browser",
    format: "esm",
    minify: { syntax: true },
    sourcemap: "none",
    define: {
      PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify({ name: "FKGCODE", slug: "fkgcode" })),
    },
  })
  expect(result.success).toBe(true)
  const bundle = await Bun.file(result.outputs[0]!.path).text()
  expect(bundle).toContain("FKGCODE")
  expect(bundle).toContain("fkgcode")
  expect(bundle).toContain("server listening on")
  expect(bundle).not.toContain("FKGCODE server listening")
  expect(bundle).not.toContain("ForeachCode")
  expect(bundle).not.toContain("foreachcode")
  await rm(directory, { recursive: true, force: true })
})

test("generated API comments are not runtime product identity", async () => {
  const result = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../src/v2/client.ts")],
    outdir: await mkdtemp(path.join(os.tmpdir(), "sdk-client-brand-")),
    target: "browser",
    format: "esm",
    minify: { syntax: true },
    sourcemap: "none",
    define: {
      PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify({ name: "FKGCODE", slug: "fkgcode" })),
    },
  })
  expect(result.success).toBe(true)
  const bundle = await Bun.file(result.outputs[0]!.path).text()
  expect(bundle).not.toContain("ForeachCode")
  expect(bundle).not.toContain("foreachcode")
})
