import { Auth } from "@/auth"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProductHttpPolicy } from "@/product/http-policy"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx) {
      return yield* ProductHttpPolicy.translate(
        Effect.gen(function* () {
          yield* auth.writePreflight()
          const payload = yield* HttpServerRequest.schemaBodyJson(Auth.Info).pipe(
            Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))),
          )
          yield* auth.set(ctx.params.providerID, payload).pipe(Effect.orDie)
          return true
        }),
      )
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx) {
      return yield* ProductHttpPolicy.translate(
        Effect.gen(function* () {
          yield* auth.writePreflight()
          yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
          return true
        }),
      )
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handleRaw("authSet", authSet).handleRaw("authRemove", authRemove).handle("log", log)
  }),
)
