import { describe, expect, test } from "bun:test"
import { providerCatalogRegistered, providerUiState } from "./settings-providers"

describe("SettingsProviders", () => {
  test("keeps administrator provider rows visible while removing catalog and all management actions", () => {
    expect(providerUiState({ managedBy: "admin", configurableByUser: false })).toEqual({
      visible: true,
      connect: false,
      configure: false,
      disconnect: false,
    })
    expect(providerCatalogRegistered()).toBeFalse()
  })
})
