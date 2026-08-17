import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "./index"
import { runtimePluginOrigins as tuiRuntimePluginOrigins } from "./tui/runtime"

const config = {
  get: () => Effect.succeed({ plugin_origins: [{ spec: "project-plugin", source: "project", scope: "local" }] }),
  getAdminIntegrations: () => Effect.succeed({ plugin: ["admin-plugin"], providers: [] }),
}

test("服务端插件初始化根只注册管理员快照中的插件", async () => {
  expect(await Effect.runPromise(Plugin.runtimePluginOrigins(config))).toEqual([
    { spec: "admin-plugin", source: "admin", scope: "global" },
  ])
})

test("TUI 插件初始化根只注册管理员快照中的插件", async () => {
  expect(await Effect.runPromise(tuiRuntimePluginOrigins(config))).toEqual([
    { spec: "admin-plugin", source: "admin", scope: "global" },
  ])
})

test("服务端与 TUI 生产初始化调用管理员插件根而非合并来源", async () => {
  const server = await Bun.file(import.meta.dir + "/index.ts").text()
  const tui = await Bun.file(import.meta.dir + "/tui/runtime.ts").text()

  expect(server).toContain("initializePluginRegistry(config)")
  expect(tui).toContain("initializePluginRegistry(yield* Config.Service)")
  expect(tui).not.toContain("config.plugin_origins ??")
  expect(tui).not.toContain("TuiConfig.pluginOrigins()")
})
