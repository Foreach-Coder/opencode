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

  test("enterprise capability authorization follows the operation matrix", () => {
    const profile: Product.ProductProfile = {
      ...Product.profile,
      operations: {
        ...Product.profile.operations,
        "share.public": "allow",
      },
    }

    expect(Product.assertCapability(profile, "publicShare")).toBeUndefined()
  })

  test("administrator static provider reads are authorized while provider management is rejected", () => {
    expect(Product.authorize(Product.profile, "provider.read")).toEqual({ decision: "allow-admin-static" })

    expect(() => Product.authorize(Product.profile, "provider.manage")).toThrow(Product.ProductError)
    try {
      Product.authorize(Product.profile, "provider.manage")
    } catch (error) {
      expect(Product.isProductError(error)).toBe(true)
      expect((error as Product.ProductError).code).toBe("PROVIDER_MANAGED_BY_ADMIN")
    }
  })
})
