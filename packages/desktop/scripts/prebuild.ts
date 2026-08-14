#!/usr/bin/env bun
import { $ } from "bun"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"
import path from "node:path"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
if (process.env.PRODUCT_BUILD_STAGE) {
  const { generateMetainfo } = await import("./copy-metainfo")
  const manifest = await Bun.file(path.join(process.env.PRODUCT_BUILD_STAGE, "brand.json")).json()
  await Bun.write(
    path.join(process.env.PRODUCT_BUILD_STAGE, "resources", "icons", "app-icon.svg"),
    Bun.file(manifest.visuals.appIcon.path),
  )
  const brand = resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)
  await generateMetainfo(channel, path.join(process.env.PRODUCT_BUILD_STAGE, "resources"), brand)
} else {
  await $`bun ./scripts/copy-metainfo.ts ${channel}`
}

await $`cd ../opencode && bun script/build-node.ts`
