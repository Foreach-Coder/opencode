import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"

describe("desktop menu", () => {
  test("exports logs through the desktop command registry outside of help links", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.labelKey === "desktop.menu.exportLogs",
    )

    expect(items).toHaveLength(1)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })

  test("provides translated labels for role-backed entries", () => {
    const windowMenu = DESKTOP_MENU.find((menu) => menu.role === "windowMenu")
    const roleItems = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.role && item.labelKey,
    )

    expect(windowMenu?.labelKey).toBe("desktop.menu.window")
    expect(roleItems.length).toBeGreaterThan(0)
  })

  test("hides product-disabled update actions", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter((item) => item.type === "item")

    expect(items.some((item) => item.type === "item" && item.action === "app.checkForUpdates")).toBe(false)
  })

  test("hides external help links for the product build", () => {
    expect(DESKTOP_MENU.some((menu) => menu.id === "help")).toBe(false)
    expect(
      DESKTOP_MENU.flatMap((menu) => menu.items ?? []).some(
        (item) => item.type === "item" && item.href?.includes("opencode"),
      ),
    ).toBe(false)
  })
})
