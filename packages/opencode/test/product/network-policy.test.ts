import { afterEach, describe, expect, test } from "bun:test"
import { ProductPolicy } from "../../src/product/network-policy"
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

  test("share and update HTTP calls reject before service lookup or body decoding", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const share = await Server.Default().app.request("/session/ses_00000000000000000000000000/share", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })
    const update = await Server.Default().app.request("/global/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "sensitive-invalid-json",
    })

    expect(share.status).toBe(403)
    expect(await share.json()).toMatchObject({ code: "PUBLIC_SHARE_DISABLED" })
    expect(update.status).toBe(403)
    expect(await update.json()).toMatchObject({ code: "PUBLIC_UPDATE_DISABLED" })
  })
})
