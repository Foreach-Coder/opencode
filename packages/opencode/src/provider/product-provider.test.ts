import { expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Provider } from "./provider"

const provider = {
  id: ProviderV2.ID.make("openai-proxy"),
  name: "OpenAI Proxy",
  source: "config" as const,
  env: [],
  options: {},
  models: {},
} satisfies Provider.Info

test("管理员 Provider 的公开信息标记为不可由用户配置", () => {
  expect(Provider.toPublicInfo(provider)).toMatchObject({
    managedBy: "admin",
    configurableByUser: false,
  })
})

test("Provider 初始化根只保留管理员 Provider 和模型", async () => {
  const config = {
    get: () =>
      Effect.succeed({
        provider: { environment: {}, oauth: {}, "public-catalog": {} },
      }),
    getAdminProviderConfig: () =>
      Effect.succeed({
        provider: { "openai-proxy": { models: { "gpt-4.1": {} } } },
      }),
  }

  expect(await Effect.runPromise(Provider.runtimeProviderEntries(config))).toEqual([
    ["openai-proxy", { models: { "gpt-4.1": {} } }],
  ])
})

test("Provider 生产初始化调用管理员注册根而非合并配置", async () => {
  const source = await Bun.file(import.meta.dir + "/provider.ts").text()
  const initialization = source.slice(source.indexOf("const layer = Layer.effect"), source.indexOf("// extend database from config"))

  expect(initialization).toContain("initializeProviderRegistry(config)")
  expect(initialization).not.toContain("config.get()")
})
