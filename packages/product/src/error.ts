import type { ProductOperation } from "./profile"

export type ErrorCode =
  | "PRODUCT_CAPABILITY_DISABLED"
  | "PROVIDER_MANAGED_BY_ADMIN"
  | "CONFIG_WRITE_DISABLED"
  | "PUBLIC_SHARE_DISABLED"
  | "PUBLIC_UPDATE_DISABLED"

export class ProductError extends Error {
  override readonly name = "ProductError"

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export function isProductError(error: unknown): error is ProductError {
  return error instanceof ProductError
}

export function errorCodeForOperation(operation: ProductOperation): ErrorCode {
  if (operation === "config.write.integration") return "CONFIG_WRITE_DISABLED"
  if (operation === "provider.manage") return "PROVIDER_MANAGED_BY_ADMIN"
  if (operation === "share.public") return "PUBLIC_SHARE_DISABLED"
  if (operation === "update.public") return "PUBLIC_UPDATE_DISABLED"
  return "PRODUCT_CAPABILITY_DISABLED"
}

export function messageForOperation(operation: ProductOperation) {
  return `产品操作 ${operation} 已禁用`
}
