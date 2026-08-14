#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")
const productBrand = resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)
const productVisual = process.env.PRODUCT_VISUAL_JSON
if (!productVisual) throw new Error("PRODUCT_VISUAL_JSON is required")
const output = process.env.PRODUCT_BUILD_STAGE ? path.join(process.env.PRODUCT_BUILD_STAGE, "server") : "./dist/node"

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: output,
  format: "esm",
  sourcemap: process.env.PRODUCT_BUILD_STAGE ? "none" : "linked",
  // Keep jsonc-parser external for the second Electron Vite pass. Its package
  // exposes an ESM build there; bundling its UMD entry here leaves relative
  // runtime requires such as ./impl/format unresolved inside app.asar.
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify(productBrand)),
    PRODUCT_VISUAL_JSON: JSON.stringify(productVisual),
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
