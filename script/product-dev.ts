#!/usr/bin/env bun
import path from "node:path"
import { prepareProductBuild } from "./product-build"

const separator = Bun.argv.indexOf("--")
const config = Bun.argv[2]
const command = separator === -1 ? [] : Bun.argv.slice(separator + 1)
if (!config || command.length === 0) {
  throw new Error("Usage: bun script/product-dev.ts <brand-config> -- <command> [args...]")
}

const root = path.resolve(import.meta.dir, "..")
const build = await prepareProductBuild({ root, args: ["--brand-config", config], env: process.env })
const child = Bun.spawn(command, {
  cwd: root,
  env: {
    ...process.env,
    PRODUCT_BRAND_JSON: JSON.stringify(build.brand),
    PRODUCT_VISUAL_JSON: JSON.stringify(build.visualPayload),
    OPENCODE_CHANNEL: build.channel,
    OPENCODE_VERSION: build.version,
    MODELS_DEV_API_JSON: build.modelsSnapshot,
    VITE_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_ORG: "",
    SENTRY_PROJECT: "",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await child.exited)
