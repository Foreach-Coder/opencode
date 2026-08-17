import { Product } from "@foreachcode/product"
import { Cause, Effect } from "effect"
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

export function translate<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchCause((cause) => {
      const error = productError(cause)
      if (!error) return Effect.failCause(cause)
      return Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { code: error.code, message: error.message },
          { status: 403 },
        ),
      )
    }),
  )
}

function productError(cause: Cause.Cause<unknown>) {
  const errors = cause.reasons.map((reason) =>
    Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : undefined,
  )
  if (errors.length === 0 || !errors.every(Product.isProductError)) return
  return errors[0]
}

export * as ProductHttpPolicy from "./http-policy"
