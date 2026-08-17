import path from "node:path"
import { Product, deriveChannelIdentity } from "@foreachcode/product"

const configFilenames = ["config.json", "opencode.json", "opencode.jsonc"] as const

/** Resolves the upstream-compatible product configuration locations for a home directory. */
export function resolveProductConfigPaths(home: string, channel: "dev" | "prod" = "prod") {
  const configDirectory = path.win32.join(home, ".config", deriveChannelIdentity(Product.profile, channel).directoryName)
  return {
    configDirectory,
    configFiles: configFilenames.map((name) => path.win32.join(configDirectory, name)),
  }
}
