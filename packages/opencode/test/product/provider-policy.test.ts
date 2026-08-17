import { afterEach, describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { ProviderPolicy } from "../../src/product/provider-policy"
import { Server } from "../../src/server/server"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENCODE_CONFIG_CONTENT
  await disposeAllInstances()
  await resetDatabase()
})

describe("admin-static-only providers", () => {
  test("configured provider and model are usable but managed by admin", () => {
    const result = ProviderPolicy.listAdminProviders({
      provider: {
        "openai-proxy": {
          npm: "@ai-sdk/openai-compatible",
          name: "openai-proxy",
          options: { baseURL: "https://llm.internal.example/v1" },
          models: { "gpt-4.1": { name: "GPT 4.1" } },
        },
      },
      model: "openai-proxy/gpt-4.1",
    })
    expect(result).toEqual([
      {
        id: "openai-proxy",
        name: "openai-proxy",
        managedBy: "admin",
        configurableByUser: false,
        models: [{ id: "openai-proxy/gpt-4.1", name: "GPT 4.1" }],
      },
    ])
  })

  test("environment, auth and public catalog cannot add providers", () => {
    expect(ProviderPolicy.listAdminProviders({ provider: {}, model: undefined })).toEqual([])
  })

  test("HTTP provider reads expose only configured providers and no OAuth methods", async () => {
    process.env.ANTHROPIC_API_KEY = "must-not-add-provider"
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      model: "attacker/model",
      enabled_providers: ["attacker"],
      disabled_providers: ["openai-proxy"],
      provider: {
        "openai-proxy": {
          npm: "attacker-package",
          options: { baseURL: "https://attacker.invalid" },
          models: { injected: { name: "Injected" } },
        },
        attacker: { npm: "attacker-package", models: { model: { name: "Attacker" } } },
      },
    })
    await using global = await tmpdir({
      config: {
        model: "openai-proxy/gpt-4.1",
        provider: {
          "openai-proxy": {
            npm: "@ai-sdk/openai-compatible",
            name: "openai-proxy",
            options: { baseURL: "https://llm.internal.example/v1", apiKey: "admin-key" },
            models: { "gpt-4.1": { name: "GPT 4.1" } },
          },
        },
      },
    })
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path
    await disposeAllInstances()
    const headers = { "x-opencode-directory": tmp.path }

    try {
      const providers = await Server.Default().app.request("/provider", { headers })
      const auth = await Server.Default().app.request("/provider/auth", { headers })
      const authorize = await Server.Default().app.request("/provider/openai-proxy/oauth/authorize", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "sensitive-invalid-json",
      })
      const body = await providers.json()

      expect(providers.status).toBe(200)
      expect(body.all.map((provider: { id: string }) => provider.id)).toEqual(["openai-proxy"])
      expect(body.all[0]).toMatchObject({
        id: "openai-proxy",
        source: "config",
        options: { baseURL: "https://llm.internal.example/v1", apiKey: "admin-key" },
      })
      expect(Object.keys(body.all[0].models)).toEqual(["gpt-4.1"])
      expect(await auth.json()).toEqual({})
      expect(authorize.status).toBe(403)
      expect(await authorize.json()).toMatchObject({ code: "PROVIDER_MANAGED_BY_ADMIN" })
    } finally {
      ;(Global.Path as { config: string }).config = previous
      await disposeAllInstances()
    }
  })
})
