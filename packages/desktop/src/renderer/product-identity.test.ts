import { expect, test } from "bun:test"
import { desktopNotificationIcon, desktopWindowStateKey, desktopVisibleVersion } from "./product-identity"

test("renderer identity uses the branded storage namespace and local icon", () => {
  expect(desktopWindowStateKey("main")).toBe("bluedcode.desktop.window.main.last-active-url")
  expect(desktopNotificationIcon).toBe("./favicon.png")
})

test("renderer exposes the release version supplied by the desktop process", () => {
  expect(desktopVisibleVersion({ version: "1.18.18-260816-01-0123456789" })).toBe("1.18.18-260816-01-0123456789")
})
