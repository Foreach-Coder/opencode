import { Product, deriveChannelIdentity } from "@foreachcode/product"

export function resolveDesktopProductIdentity(channel: "dev" | "prod") {
  return deriveChannelIdentity(Product.profile, channel)
}

export function resolveDesktopRuntimeIdentity(channel: "dev" | "prod" = process.env.OPENCODE_CHANNEL === "prod" ? "prod" : "dev") {
  return resolveDesktopProductIdentity(channel)
}

export function setDesktopRuntimeChannel(channel: "dev" | "prod") {
  process.env.OPENCODE_CHANNEL = channel
  return resolveDesktopProductIdentity(channel)
}

export function resolveSidecarServiceName(channel?: "dev" | "prod") {
  return `${resolveDesktopRuntimeIdentity(channel).displayName} server`
}
