import { Product } from "@foreachcode/product"
import { ProductUiRegistry } from "./ui-registry"

type Provider = {
  managedBy?: unknown
  configurableByUser?: unknown
}

export const ProductCapabilities = {
  visibleProviderActions(provider: Provider) {
    return ProductUiRegistry.providerActions(Product.profile, provider)
  },

  visibleSettingsToggles() {
    return ProductUiRegistry.localPreferences(Product.profile)
  },

  visibleDesktopEntries() {
    return ProductUiRegistry.desktopEntries(Product.profile)
  },
}
