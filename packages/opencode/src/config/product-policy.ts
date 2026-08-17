import { Product } from "@foreachcode/product"

export type WriteClassification =
  | { kind: "preference"; allowed: true }
  | { kind: "integration"; allowed: false }

export function classifyWrite(payload: unknown): WriteClassification {
  if (!isLocalPreferenceWrite(payload)) return { kind: "integration", allowed: false }
  return { kind: "preference", allowed: true }
}

export function requireWrite(payload: unknown) {
  const classification = classifyWrite(payload)
  try {
    Product.authorize(Product.profile, classification.allowed ? "config.write.preference" : "config.write.integration")
  } catch (error) {
    if (Product.isProductError(error) && error.code === "CONFIG_WRITE_DISABLED") {
      throw new Product.ProductError(error.code, `${error.code}: ${error.message}`, { cause: error })
    }
    throw error
  }
  return classification
}

function isLocalPreferenceWrite(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const entries = Object.entries(payload)
  if (!entries.length) return false
  return entries.every(([key, value]) => {
    if (!Product.localPreferenceKeys.includes(key as never)) return false
    return isLocalPreferenceValue(key, value)
  })
}

function isLocalPreferenceValue(key: string, value: unknown) {
  if (key === "keybinds") return isStringRecord(value)
  if (key === "notifications" || key === "newLayoutDesigns") return typeof value === "boolean"
  return typeof value === "string"
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

export * as ProductConfigPolicy from "./product-policy"
