import { describe, expect, test } from "bun:test"
import {
  DESKTOP_APP_IDS,
  DESKTOP_APP_NAMES,
  DESKTOP_PROTOCOL,
  desktopAppId,
  desktopUserDataPath,
  deepLinksFromArgv,
} from "./identity"
import { Brand } from "@opencode-ai/brand"
import path from "node:path"

describe("desktop identity", () => {
  test("uses independent product identities for every channel", () => {
    expect(DESKTOP_APP_IDS).toEqual({
      dev: Brand.desktop.dev.appId,
      beta: Brand.desktop.beta.appId,
      prod: Brand.desktop.prod.appId,
    })
    expect(DESKTOP_APP_NAMES).toEqual({
      dev: Brand.desktop.dev.name,
      beta: Brand.desktop.beta.name,
      prod: Brand.desktop.prod.name,
    })
    expect(desktopAppId("prod", true)).toBe(Brand.desktop.prod.appId)
    expect(desktopAppId("prod", false)).toBe(Brand.desktop.dev.appId)
    expect(desktopUserDataPath("C:\\Users\\dev\\AppData\\Roaming", "beta", true)).toBe(
      `C:\\Users\\dev\\AppData\\Roaming\\${Brand.desktop.beta.appId}`,
    )
  })

  test("accepts only product deep links", () => {
    expect(DESKTOP_PROTOCOL).toBe(Brand.protocol)
    expect(deepLinksFromArgv([`${Brand.protocol}://session/1`, "opencode://session/2", "--flag"])).toEqual([
      `${Brand.protocol}://session/1`,
    ])
  })

  test("queues product deep links from the first Windows process argv", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "index.ts")).text()

    expect(source).toContain("emitDeepLinks(deepLinksFromArgv(process.argv))")
  })
})
