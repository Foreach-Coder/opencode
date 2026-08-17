import { describe, expect, test } from "bun:test"
import { Product } from "../src"

describe("Product capabilities", () => {
  test("disabled public share fails with stable code", () => {
    expect(() => Product.assertCapability(Product.profile, "publicShare")).toThrow(Product.ProductError)
    try {
      Product.assertCapability(Product.profile, "publicShare")
    } catch (error) {
      expect(Product.isProductError(error)).toBe(true)
      expect((error as Product.ProductError).code).toBe("PUBLIC_SHARE_DISABLED")
    }
  })

  test("desktop capability is allowed", () => {
    expect(Product.assertCapability(Product.profile, "desktop")).toBeUndefined()
  })
})
