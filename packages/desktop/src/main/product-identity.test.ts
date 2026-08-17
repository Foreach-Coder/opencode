import { describe, expect, test } from "bun:test"
import {
  deriveDesktopIdentity,
  resolveDesktopProductIdentity,
  resolveDesktopRuntimeIdentity,
  resolveSidecarServiceName,
  setDesktopRuntimeChannel,
} from "./product-identity"

describe("Desktop product identity", () => {
  test("derives isolated runtime identity payloads from the product profile", () => {
    expect(deriveDesktopIdentity("prod", "1.18.18-260816-01-a39a781eb3")).toMatchObject({
      displayName: "BluedCode",
      directoryName: "bluedcode",
      appId: "ai.bluedcode.desktop",
      protocol: "bluedcode",
      visibleVersion: "1.18.18-260816-01-a39a781eb3",
      userDataKey: "ai.bluedcode.desktop",
    })
    expect(deriveDesktopIdentity("dev", "1.18.18-dev")).toMatchObject({
      displayName: "BluedCode Dev",
      directoryName: "bluedcode-dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      visibleVersion: "1.18.18-dev",
      userDataKey: "ai.bluedcode.desktop.dev",
    })
  })

  test("prod and dev app identity are isolated", () => {
    expect(resolveDesktopProductIdentity("prod")).toMatchObject({
      displayName: "BluedCode",
      appId: "ai.bluedcode.desktop",
      protocol: "bluedcode",
    })
    expect(resolveDesktopProductIdentity("dev")).toMatchObject({
      displayName: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
    })
  })

  test("runtime identity follows the desktop channel", () => {
    expect(resolveDesktopRuntimeIdentity("prod").directoryName).toBe("bluedcode")
    expect(resolveDesktopRuntimeIdentity("dev").directoryName).toBe("bluedcode-dev")
  })

  test("prod runtime channel is exported for the embedded core", () => {
    const previous = process.env.OPENCODE_CHANNEL
    try {
      expect(setDesktopRuntimeChannel("prod").channel).toBe(process.env.OPENCODE_CHANNEL)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = previous
    }
  })

  test("sidecar service name follows the runtime channel at spawn time", () => {
    expect(resolveSidecarServiceName("prod")).toBe("BluedCode server")
    expect(resolveSidecarServiceName("dev")).toBe("BluedCode Dev server")
  })
})
