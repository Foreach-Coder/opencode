import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProductHttpPolicy } from "@/product/http-policy"

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const connected = yield* provider.list()
      return {
        all: Object.values(connected).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(connected),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx) {
      return yield* ProductHttpPolicy.translate(
        Effect.gen(function* () {
          yield* svc.authorizePreflight()
          const body = yield* Effect.orDie(ctx.request.text)
          const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
            Effect.orDie,
          )
          const result = yield* svc
            .authorize({ providerID: ctx.params.providerID, method: payload.method, inputs: payload.inputs })
            .pipe(Effect.orDie)
          return HttpServerResponse.jsonUnsafe(result ?? null)
        }),
      )
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx) {
      return yield* ProductHttpPolicy.translate(
        Effect.gen(function* () {
          yield* svc.callbackPreflight()
          const body = yield* Effect.orDie(ctx.request.text)
          const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.CallbackInput))(body).pipe(
            Effect.orDie,
          )
          yield* svc
            .callback({ providerID: ctx.params.providerID, method: payload.method, code: payload.code })
            .pipe(Effect.orDie)
          return true
        }),
      )
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorize)
      .handleRaw("callback", callback)
  }),
)
