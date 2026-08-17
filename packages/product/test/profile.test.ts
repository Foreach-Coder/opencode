import { describe, expect, test } from "bun:test"
import { Product } from "../src"

describe("Product Profile", () => {
  test("production profile is the only BluedCode product identity", () => {
    expect(Product.profile.identity).toEqual({
      displayName: "BluedCode",
      directoryName: "bluedcode",
      appId: "ai.bluedcode.desktop",
      protocol: "bluedcode",
    })
    expect(Product.profile.capabilities).toMatchObject({
      desktop: true,
      cli: false,
      web: false,
      tui: false,
      updater: false,
      publicShare: false,
      telemetry: false,
      publicProviderCatalog: false,
      providerManagement: "admin-static-only",
    })
  })

  test("dev identity is deterministically isolated from prod", () => {
    expect(Product.deriveChannelIdentity(Product.profile, "dev")).toEqual({
      channel: "dev",
      displayName: "BluedCode Dev",
      directoryName: "bluedcode-dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
    })
    expect(Product.deriveChannelIdentity(Product.profile, "prod").directoryName).toBe("bluedcode")
  })

  test("profile cannot be mutated through exported references", () => {
    expect(() => {
      ;(Product.profile.identity as { displayName: string }).displayName = "OpenCode"
    }).toThrow()
    expect(Product.profile.identity.displayName).toBe("BluedCode")
  })
})
