import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { ProductPolicy } from "../../src/product/policy"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("provider, auth and config writes fail before persistence", () => {
  expect(() => ProductPolicy.rejectProviderWrite()).toThrow("PROVIDER_MANAGED_BY_ADMIN")
  expect(() => ProductPolicy.rejectAuthWrite()).toThrow("PROVIDER_MANAGED_BY_ADMIN")
  expect(() => ProductPolicy.rejectConfigWrite({ provider: { custom: {} } })).toThrow("CONFIG_WRITE_DISABLED")
})

test("auth and config HTTP writes reject before decoding or persistence", async () => {
  await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
  const configFile = path.join(tmp.path, "opencode.json")
  const before = await Bun.file(configFile).text()

  const auth = await Server.Default().app.request("/auth/openai-proxy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "sensitive-invalid-json",
  })
  const config = await Server.Default().app.request("/config", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
    body: "sensitive-invalid-json",
  })

  expect(auth.status).toBe(403)
  expect(await auth.json()).toMatchObject({ code: "PROVIDER_MANAGED_BY_ADMIN" })
  expect(config.status).toBe(403)
  expect(await config.json()).toMatchObject({ code: "CONFIG_WRITE_DISABLED" })
  expect(await Bun.file(configFile).text()).toBe(before)
})
