import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProductConfigPolicy } from "@/config/product-policy"
import { ProductHttpPolicy } from "@/product/http-policy"
import { ProductPolicy } from "@/product/policy"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* () {
      const payload = yield* HttpServerRequest.schemaBodyJson(Schema.Unknown).pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      if (!ProductConfigPolicy.classifyWrite(payload).allowed) {
        return ProductHttpPolicy.reject(() => ProductPolicy.rejectConfigWrite(payload))
      }
      yield* configSvc.update(payload as ConfigV1.Info)
      return HttpServerResponse.jsonUnsafe(yield* configSvc.get())
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers.handle("get", get).handleRaw("update", update).handle("providers", providers)
  }),
)
