import { Product } from "@foreachcode/product"
import { ProductConfigPolicy } from "@/config/product-policy"

export function requireProviderRead() {
  if (Product.profile.capabilities.providerManagement === "admin-static-only") return
  throw new Product.ProductError("PRODUCT_CAPABILITY_DISABLED", "PRODUCT_CAPABILITY_DISABLED: 产品策略已禁用 Provider 读取")
}

export function rejectProviderWrite(): never {
  throw new Product.ProductError("PROVIDER_MANAGED_BY_ADMIN", "PROVIDER_MANAGED_BY_ADMIN: Provider 由管理员静态配置")
}

export function rejectAuthWrite(): never {
  throw new Product.ProductError("PROVIDER_MANAGED_BY_ADMIN", "PROVIDER_MANAGED_BY_ADMIN: Provider 认证由管理员管理")
}

export function rejectConfigWrite(payload: unknown): never {
  ProductConfigPolicy.requireWrite(payload)
  throw new Product.ProductError("CONFIG_WRITE_DISABLED", "CONFIG_WRITE_DISABLED: 配置写入仅允许本地偏好")
}

export * as ProductPolicy from "./policy"
