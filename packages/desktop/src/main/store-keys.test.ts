import { expect, test } from "bun:test"
import { SETTINGS_STORE, UPDATER_STORE } from "./store-keys"
import { Brand } from "@opencode-ai/brand"

test("uses product-owned Electron stores", () => {
  expect(SETTINGS_STORE).toBe(`${Brand.slug}.settings`)
  expect(UPDATER_STORE).toBe(`${Brand.slug}.updater`)
})
