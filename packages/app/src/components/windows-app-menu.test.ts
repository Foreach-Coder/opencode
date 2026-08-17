import { describe, expect, test } from "bun:test"
import { Product } from "@foreachcode/product"
import { windowsAppMenuHeadingLabel } from "./windows-app-menu"

describe("windows app menu", () => {
  test("uses the product display name for the menu heading", () => {
    expect(windowsAppMenuHeadingLabel()).toBe(Product.profile.identity.displayName)
    expect(windowsAppMenuHeadingLabel()).not.toBe("OpenCode")
  })
})
