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
