import { Product } from "@foreachcode/product"
import { HttpServerResponse } from "effect/unstable/http"

export function reject(operation: () => never) {
  try {
    operation()
  } catch (error) {
    if (!Product.isProductError(error)) throw error
    return HttpServerResponse.jsonUnsafe(
      { code: error.code, message: error.message },
      { status: 403 },
    )
  }
}

export * as ProductHttpPolicy from "./http-policy"
