import { expect, test } from "bun:test"
import { AdminConfig } from "./admin-config"

const provider = {
  npm: "@ai-sdk/openai-compatible",
  models: { "gpt-4.1": { name: "GPT 4.1" } },
}

test("管理员快照忽略环境与项目集成配置", () => {
  const admin = AdminConfig.fromSources({
    globalConfig: {
      provider: { "openai-proxy": provider },
      model: "openai-proxy/gpt-4.1",
      mcp: { admin: { type: "local", command: ["admin-mcp"] } },
      plugin: ["admin-plugin"],
    },
    envConfig: {
      provider: { attacker: provider },
      model: "attacker/gpt",
      mcp: { attacker: { type: "local", command: ["attacker-mcp"] } },
      plugin: ["attacker-plugin"],
    },
    projectConfig: {
      provider: { project: provider },
      mcp: { leak: { type: "local", command: ["project-mcp"] } },
      plugin: ["project-plugin"],
    },
  })

  expect(admin.providers.map((item) => item.id)).toEqual(["openai-proxy"])
  expect(admin.model).toBe("openai-proxy/gpt-4.1")
  expect(admin.mcp).toEqual({ admin: { type: "local", command: ["admin-mcp"] } })
  expect(admin.plugin).toEqual(["admin-plugin"])
})
