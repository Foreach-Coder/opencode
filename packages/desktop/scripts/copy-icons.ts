import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = `./icons/${channel}`
const dest = process.env.PRODUCT_BUILD_STAGE
  ? path.join(process.env.PRODUCT_BUILD_STAGE, "resources", "icons")
  : "resources/icons"

await rm(dest, { recursive: true, force: true })
if (process.env.PRODUCT_BUILD_STAGE) {
  await mkdir(dest, { recursive: true })
  console.log(`Prepared isolated product icon directory at ${dest}`)
} else {
  await cp(src, dest, { recursive: true })
  console.log(`Copied ${channel} icons from ${src} to ${dest}`)
}
