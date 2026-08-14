import { expect, test } from "bun:test"
import path from "node:path"

test("build-node injects the compile-time product brand without runtime PRODUCT_* reads", async () => {
  const source = await Bun.file(path.resolve(import.meta.dir, "../script/build-node.ts")).text()
  expect(source).toContain("PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify(productBrand))")
  expect(source).toContain("PRODUCT_VISUAL_JSON: JSON.stringify(productVisual)")
  expect(source).toContain('path.join(process.env.PRODUCT_BUILD_STAGE, "server")')
  expect(source).toContain('external: ["jsonc-parser", "@lydell/node-pty"]')
  expect(source).not.toContain('process.env.PRODUCT_BUILD_STAGE ? ["@lydell/node-pty"]')
  expect(source).not.toContain("fetch(")
  expect(source).toContain('sourcemap: process.env.PRODUCT_BUILD_STAGE ? "none" : "linked"')
  expect(source).not.toContain("minify: process.env.PRODUCT_BUILD_STAGE")
})

test("non-default sidecar bundle excludes default product runtime constants", async () => {
  const bundle = process.env.PRODUCT_BUILD_CONTRACT_BUNDLE
  if (!bundle) return
  const source = await Bun.file(bundle).text()
  expect(source).not.toMatch(/name:\s*"ForeachCode"/)
  expect(source).not.toMatch(/slug:\s*"foreachcode"/)
  expect(source).not.toContain('PRODUCT_NAME = "ForeachCode"')
})
