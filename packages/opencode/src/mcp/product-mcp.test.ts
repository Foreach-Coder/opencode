import { expect, test } from "bun:test"
import { Effect } from "effect"
import { MCP } from "./index"

test("MCP 初始化根只注册管理员快照中的服务器", async () => {
  const config = {
    get: () => Effect.succeed({ mcp: { project: { type: "local", command: ["project-mcp"] } } }),
    getAdminIntegrations: () =>
      Effect.succeed({ mcp: { admin: { type: "local", command: ["admin-mcp"], enabled: false } }, providers: [] }),
  }

  expect(Object.keys(await Effect.runPromise(MCP.runtimeMcpEntries(config)))).toEqual(["admin"])
})

test("MCP 生产初始化调用管理员运行时根而非合并配置", async () => {
  const source = await Bun.file(import.meta.dir + "/index.ts").text()
  const initialization = source.slice(source.indexOf('Effect.fn("MCP.state")'), source.indexOf("function closeClient"))

  expect(initialization).toContain("initializeMcpRegistry(cfgSvc)")
  expect(initialization).not.toContain("cfgSvc.get()")
})
