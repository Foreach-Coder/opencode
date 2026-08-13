import { expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"

test("does not expose the disabled updater", () => {
  const entries = DESKTOP_MENU.flatMap((menu) => menu.items ?? [])
  expect(entries.some((entry) => entry.type === "item" && entry.action === "app.checkForUpdates")).toBeFalse()
})
