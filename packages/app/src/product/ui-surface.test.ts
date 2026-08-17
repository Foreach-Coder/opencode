import { describe, expect, test } from "bun:test"

const source = async (path: string) => await Bun.file(new URL(path, import.meta.url)).text()

describe("product UI surface gates", () => {
  test("model picker and model management provider-connect entry points are capability gated", async () => {
    const files = [
      "../components/dialog-select-model.tsx",
      "../components/dialog-manage-models.tsx",
      "../components/dialog-select-model-unpaid.tsx",
      "../components/dialog-select-model-unpaid-v2.tsx",
      "../pages/layout.tsx",
      "../pages/new-session/new-session-view.tsx",
      "../pages/session/usage-exceeded-dialogs.tsx",
    ]

    for (const file of files) {
      expect(await source(file), file).toContain("ProductCapabilities.visibleProviderActions({}).connect")
    }
  })

  test("error, layout, and titlebar update entry points are capability gated", async () => {
    const files = ["../pages/error.tsx", "../pages/layout.tsx", "../components/titlebar.tsx"]

    for (const file of files) {
      expect(await source(file), file).toContain("ProductCapabilities.visibleDesktopEntries().updater")
    }
  })
})
