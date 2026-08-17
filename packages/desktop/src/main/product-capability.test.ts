import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assertDesktopCapability } from "./product-capability"

test("CLI, WSL and updater are disabled before process or network side effects", () => {
  expect(() => assertDesktopCapability("cli")).toThrow("PRODUCT_CAPABILITY_DISABLED")
  expect(() => assertDesktopCapability("updater")).toThrow("PRODUCT_CAPABILITY_DISABLED")
  expect(() => assertDesktopCapability("wsl")).toThrow("PRODUCT_CAPABILITY_DISABLED")
})

test("disabled updater does not statically import the updater implementation", () => {
  const source = readFileSync(fileURLToPath(new URL("./updater.ts", import.meta.url)), "utf8")
  expect(source).not.toContain('from "electron-updater"')
})
