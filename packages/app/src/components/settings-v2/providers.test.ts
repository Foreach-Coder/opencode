import { describe, expect, test } from "bun:test"
import { providerCatalogRegistered, providerUiState } from "./providers"

const source = async () => await Bun.file(new URL("./providers.tsx", import.meta.url)).text()

describe("SettingsProvidersV2", () => {
  test("keeps administrator connections in the connected section and does not register a connectable catalog", async () => {
    const component = await source()

    expect(component).toContain('data-component="connected-providers-section"')
    expect(component).toContain("providerUiState(item).disconnect")
    expect(component).toContain("providerCatalogRegistered()")
  })

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
