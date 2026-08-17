import { assertCapability, authorize } from "./capability"
import { deriveChannelIdentity } from "./identity"
export { ProductError, isProductError } from "./error"
export type { ErrorCode } from "./error"
export { assertCapability, authorize, deriveChannelIdentity }

export type ProductOperation =
  | "config.write.preference"
  | "config.write.integration"
  | "provider.read"
  | "provider.manage"
  | "auth.manage"
  | "mcp.manage"
  | "plugin.manage"
  | "share.public"
  | "catalog.public"
  | "telemetry"
  | "update.public"
  | "proxy.public"

export type ProductOperationDecision = "allow" | "allow-admin-static" | "deny"

export type ProductCapability =
  | "desktop"
  | "cli"
  | "web"
  | "tui"
  | "updater"
  | "publicShare"
  | "telemetry"
  | "publicProviderCatalog"

type ProductCapabilities = {
  desktop: true
  cli: false
  web: false
  tui: false
  updater: boolean
  publicShare: boolean
  telemetry: boolean
  publicProviderCatalog: boolean
  providerManagement: "admin-static-only" | "disabled"
}

export const localPreferenceKeys = Object.freeze([
  "theme",
  "language",
  "font",
  "keybinds",
  "notifications",
  "newLayoutDesigns",
] as const)

export type ProductProfile = {
  identity: {
    displayName: "BluedCode"
    directoryName: "bluedcode"
    appId: "ai.bluedcode.desktop"
    protocol: "bluedcode"
  }
  capabilities: ProductCapabilities
  operations: Readonly<Record<ProductOperation, ProductOperationDecision>>
  localPreferences: typeof localPreferenceKeys
}

const operations = Object.freeze({
  "config.write.preference": "allow",
  "config.write.integration": "deny",
  "provider.read": "allow-admin-static",
  "provider.manage": "deny",
  "auth.manage": "deny",
  "mcp.manage": "deny",
  "plugin.manage": "deny",
  "share.public": "deny",
  "catalog.public": "deny",
  telemetry: "deny",
  "update.public": "deny",
  "proxy.public": "deny",
} as const)

export const profile: Readonly<ProductProfile> = Object.freeze({
  identity: Object.freeze({
    displayName: "BluedCode",
    directoryName: "bluedcode",
    appId: "ai.bluedcode.desktop",
    protocol: "bluedcode",
  }),
  capabilities: deriveCapabilities(operations),
  operations,
  localPreferences: localPreferenceKeys,
})

function deriveCapabilities(operations: Readonly<Record<ProductOperation, ProductOperationDecision>>): ProductCapabilities {
  return Object.freeze({
    desktop: true,
    cli: false,
    web: false,
    tui: false,
    updater: operations["update.public"] === "allow",
    publicShare: operations["share.public"] === "allow",
    telemetry: operations.telemetry === "allow",
    publicProviderCatalog: operations["catalog.public"] === "allow",
    providerManagement: operations["provider.read"] === "allow-admin-static" ? "admin-static-only" : "disabled",
  })
}

export function profileDigest(profile: ProductProfile) {
  return JSON.stringify(stabilize(profile))
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stabilize((value as Record<string, unknown>)[key])]))
  }
  return value
}
