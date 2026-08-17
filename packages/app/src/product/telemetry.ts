import { Product, authorize } from "@foreachcode/product"

export type ProductTelemetryInit = {
  dsn?: string
  environment?: string
  release?: string
}

function telemetryAllowed() {
  try {
    authorize(Product.profile, "telemetry")
    return true
  } catch {
    return false
  }
}

export const ProductTelemetry = {
  isEnabled() {
    return telemetryAllowed()
  },
  init(_options: ProductTelemetryInit) {
    return false
  },
  captureException(_error: unknown) {
    return false
  },
}
