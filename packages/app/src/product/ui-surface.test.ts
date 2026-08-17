import { describe, expect, test } from "bun:test"

const source = async (path: string) => await Bun.file(new URL(path, import.meta.url)).text()

describe("product UI surface gates", () => {
  test("provider settings render administrator connections as read-only instead of connectable suppliers", async () => {
    const files = [
      "../components/settings-providers.tsx",
      "../components/settings-v2/providers.tsx",
    ]

    for (const file of files) {
      expect(await source(file), file).toContain("ProductUiRegistry.surface(Product.profile).settings.providers")
      expect(await source(file), file).toContain("ProductUiRegistry.providerActions(Product.profile")
    }
  })

  test("model pickers and custom provider forms use the registry instead of owning connect decisions", async () => {
    const files = [
      "../components/dialog-select-model.tsx",
      "../components/dialog-select-model-unpaid.tsx",
      "../components/dialog-select-model-unpaid-v2.tsx",
      "../components/dialog-custom-provider.tsx",
    ]

    for (const file of files) {
      expect(await source(file), file).toContain("ProductUiRegistry.surface(Product.profile).providerActions")
    }
  })

  test("V1 and V2 settings dialogs register tabs through the registry", async () => {
    const files = ["../components/dialog-settings.tsx", "../components/settings-v2/dialog-settings-v2.tsx"]

    for (const file of files) {
      expect(await source(file), file).toContain("ProductUiRegistry.settingsTabs(Product.profile)")
      expect(await source(file), file).toContain("<Show when={settingsTabs.providers}>")
      expect(await source(file), file).toContain("<Show when={settingsTabs.servers}>")
    }
  })
})
