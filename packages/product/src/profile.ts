import { assertCapability } from "./capability"
import { deriveChannelIdentity } from "./identity"
export { ProductError, isProductError } from "./error"
export type { ErrorCode } from "./error"
export { assertCapability, deriveChannelIdentity }

export type ProductProfile = {
  identity: {
    displayName: "BluedCode"
    directoryName: "bluedcode"
    appId: "ai.bluedcode.desktop"
    protocol: "bluedcode"
  }
  capabilities: {
    desktop: true
    cli: false
    web: false
    tui: false
    updater: false
    publicShare: false
    telemetry: false
    publicProviderCatalog: false
    providerManagement: "admin-static-only"
  }
}

export const profile: Readonly<ProductProfile> = Object.freeze({
  identity: Object.freeze({
    displayName: "BluedCode",
    directoryName: "bluedcode",
    appId: "ai.bluedcode.desktop",
    protocol: "bluedcode",
  }),
  capabilities: Object.freeze({
    desktop: true,
    cli: false,
    web: false,
    tui: false,
    updater: false,
    publicShare: false,
    telemetry: false,
    publicProviderCatalog: false,
    providerManagement: "admin-static-only",
  }),
})
