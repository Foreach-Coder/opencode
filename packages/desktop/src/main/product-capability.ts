import { Product, assertCapability, isProductError } from "@foreachcode/product"

type DesktopCapability = "cli" | "updater" | "wsl"

export function assertDesktopCapability(capability: DesktopCapability) {
  try {
    assertCapability(Product.profile, capability === "wsl" ? "cli" : capability)
  } catch (error) {
    if (isProductError(error)) throw new Error("PRODUCT_CAPABILITY_DISABLED", { cause: error })
    throw error
  }
}
