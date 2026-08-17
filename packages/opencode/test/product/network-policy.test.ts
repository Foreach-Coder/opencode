import { afterEach, describe, expect, test } from "bun:test"
import { Product } from "@foreachcode/product"
import { Cause, Effect, Exit } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { ProductPolicy } from "../../src/product/network-policy"
import { ProductHttpPolicy } from "../../src/product/http-policy"
import { Server } from "../../src/server/server"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Otlp } from "@opencode-ai/core/observability/otlp"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("public network product policy", () => {
  test("translates service-root product failures to the shared HTTP response", async () => {
    const response = await Effect.runPromise(
      ProductHttpPolicy.translate(
        Effect.fail(new Product.ProductError("PUBLIC_SHARE_DISABLED", "PUBLIC_SHARE_DISABLED: sharing is disabled")),
      ),
    )
    const web = HttpServerResponse.toWeb(response)

    expect(web.status).toBe(403)
    await expect(web.json()).resolves.toEqual({
      code: "PUBLIC_SHARE_DISABLED",
      message: "PUBLIC_SHARE_DISABLED: sharing is disabled",
    })
  })

  test("preserves mixed product and unexpected service causes", async () => {
    const exit = await Effect.runPromiseExit(
      ProductHttpPolicy.translate(
        Effect.failCause(
          Cause.fromReasons([
            Cause.makeFailReason(new Product.ProductError("PUBLIC_SHARE_DISABLED", "sharing is disabled")),
            Cause.makeDieReason(new Error("unexpected service defect")),
          ]),
        ),
      ),
    )

    expect(Exit.isFailure(exit)).toBeTrue()
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("unexpected service defect")
  })

  test("share, update, model catalog, telemetry and proxy are rejected before network", () => {
    expect(() => ProductPolicy.rejectPublicShare()).toThrow("PUBLIC_SHARE_DISABLED")
    expect(() => ProductPolicy.rejectPublicUpdate()).toThrow("PUBLIC_UPDATE_DISABLED")
    expect(() => ProductPolicy.rejectPublicCatalog()).toThrow("PRODUCT_CAPABILITY_DISABLED")
    expect(() => ProductPolicy.rejectTelemetry()).toThrow("PRODUCT_CAPABILITY_DISABLED")
    expect(() => ProductPolicy.rejectPublicProxy()).toThrow("PRODUCT_CAPABILITY_DISABLED")
  })

  test("core catalog and telemetry exporters reuse the product network boundary", () => {
    expect(() => ModelsDev.requirePublicCatalogNetwork()).toThrow("PRODUCT_CAPABILITY_DISABLED")
    expect(() => Otlp.requireTelemetryNetwork()).toThrow("PRODUCT_CAPABILITY_DISABLED")
  })

  test("share, update, provider, and auth handlers translate service-root failures before body decoding", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const app = Server.Default().app
    const share = await app.request("/session/ses_00000000000000000000000000/share", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })
    const update = await app.request("/global/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "sensitive-invalid-json",
    })
    const provider = await app.request("/provider/openai/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      body: "sensitive-invalid-json",
    })
    const auth = await app.request("/auth/openai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "sensitive-invalid-json",
    })

    expect(share.status).toBe(403)
    expect(await share.json()).toMatchObject({ code: "PUBLIC_SHARE_DISABLED", message: expect.any(String) })
    expect(update.status).toBe(403)
    expect(await update.json()).toMatchObject({ code: "PUBLIC_UPDATE_DISABLED", message: expect.any(String) })
    expect(provider.status).toBe(403)
    expect(await provider.json()).toMatchObject({ code: "PROVIDER_MANAGED_BY_ADMIN", message: expect.any(String) })
    expect(auth.status).toBe(403)
    expect(await auth.json()).toMatchObject({ code: "PROVIDER_MANAGED_BY_ADMIN", message: expect.any(String) })
  })
})
