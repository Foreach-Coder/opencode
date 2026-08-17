import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProductPolicy } from "@/product/policy"
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

    const authorize = Effect.fn("ProviderHttpApi.authorize")(() =>
      Effect.succeed(ProductHttpPolicy.reject(ProductPolicy.rejectProviderWrite)),
    )

    const callback = Effect.fn("ProviderHttpApi.callback")(() =>
      Effect.succeed(ProductHttpPolicy.reject(ProductPolicy.rejectAuthWrite)),
    )

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorize)
      .handleRaw("callback", callback)
  }),
)
