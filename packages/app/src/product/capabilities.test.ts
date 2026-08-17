import { describe, expect, test } from "bun:test"
import { ProductCapabilities } from "./capabilities"

describe("ProductCapabilities", () => {
  test("treats administrator providers as connected data without user management actions", () => {
    expect(
      ProductCapabilities.visibleProviderActions({
        managedBy: "admin",
        configurableByUser: false,
      }),
    ).toEqual({ connect: false, configure: false, disconnect: false })
  })

  test("hides public provider management while keeping the new layout switch available and off by default", () => {
    expect(ProductCapabilities.visibleProviderActions({})).toEqual({
      connect: false,
      configure: false,
      disconnect: false,
    })
    expect(ProductCapabilities.visibleSettingsToggles({ newLayout: undefined })).toEqual({
      newLayout: true,
      defaultNewLayout: false,
    })
  })

  test("hides disabled public desktop entries", () => {
    expect(ProductCapabilities.visibleDesktopEntries()).toEqual({
      updater: false,
      cli: false,
      wsl: false,
      share: false,
    })
  })
})
