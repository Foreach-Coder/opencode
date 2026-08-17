import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProductPolicy } from "@/product/policy"
import { ProductHttpPolicy } from "@/product/http-policy"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const authSet = Effect.fn("ControlHttpApi.authSet")(() =>
      Effect.succeed(ProductHttpPolicy.reject(ProductPolicy.rejectAuthWrite)),
    )

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(() =>
      Effect.succeed(ProductHttpPolicy.reject(ProductPolicy.rejectAuthWrite)),
    )

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
