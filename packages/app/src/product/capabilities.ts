import { Product } from "@foreachcode/product"

type Provider = {
  managedBy?: unknown
  configurableByUser?: unknown
}

export const ProductCapabilities = {
  visibleProviderActions(provider: Provider) {
    const managedByAdmin = provider.managedBy === "admin" || provider.configurableByUser === false
    if (managedByAdmin || Product.profile.capabilities.providerManagement === "admin-static-only") {
      return { connect: false, configure: false, disconnect: false }
    }
    return { connect: true, configure: true, disconnect: true }
  },

  visibleSettingsToggles(_state: { newLayout?: boolean }) {
    return { newLayout: true, defaultNewLayout: false }
  },

  visibleDesktopEntries() {
    return {
      updater: Product.profile.capabilities.updater,
      cli: Product.profile.capabilities.cli,
      wsl: false,
      share: Product.profile.capabilities.publicShare,
    }
  },
}
