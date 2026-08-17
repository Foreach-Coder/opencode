import { Product } from "@foreachcode/product"

export type PublicNetworkKind = "share" | "update" | "catalog" | "telemetry" | "proxy"

export function rejectPublicNetwork(kind: PublicNetworkKind): never {
  throw new Product.ProductError(
    kind === "share"
      ? "PUBLIC_SHARE_DISABLED"
      : kind === "update"
        ? "PUBLIC_UPDATE_DISABLED"
        : "PRODUCT_CAPABILITY_DISABLED",
    `${kind === "share" ? "PUBLIC_SHARE_DISABLED" : kind === "update" ? "PUBLIC_UPDATE_DISABLED" : "PRODUCT_CAPABILITY_DISABLED"}: 公共网络能力 ${kind} 已由产品策略禁用`,
  )
}

export function rejectPublicShare(): never {
  return rejectPublicNetwork("share")
}

export function rejectPublicUpdate(): never {
  return rejectPublicNetwork("update")
}

export function rejectPublicCatalog(): never {
  return rejectPublicNetwork("catalog")
}

export function rejectTelemetry(): never {
  return rejectPublicNetwork("telemetry")
}

export function rejectPublicProxy(): never {
  return rejectPublicNetwork("proxy")
}

export * as ProductPolicy from "./network-policy"
