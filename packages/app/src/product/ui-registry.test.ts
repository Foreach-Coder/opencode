import { describe, expect, test } from "bun:test"
import { Product } from "@foreachcode/product"
import { ProductUiRegistry } from "./ui-registry"

describe("ProductUiRegistry", () => {
  test("derives the enterprise settings and public-action surface from the product profile", () => {
    expect(ProductUiRegistry.surface(Product.profile)).toMatchObject({
      settings: { general: true, providers: "readonly-admin" },
      providerActions: { connect: false, configure: false, disconnect: false },
      localPreferences: {
        theme: true,
        language: true,
        font: true,
        keybinds: true,
        notifications: true,
        newLayoutDesigns: true,
      },
      publicActions: { share: false, update: false },
    })
  })

  test("keeps administrator providers connected and read-only", () => {
    expect(
      ProductUiRegistry.providerActions(Product.profile, {
        managedBy: "admin",
        configurableByUser: false,
      }),
    ).toEqual({ connect: false, configure: false, disconnect: false })
  })

  test("registers only local preference and read-only administrator settings tabs", () => {
    expect(ProductUiRegistry.settingsTabs(Product.profile)).toEqual({
      general: true,
      shortcuts: true,
      servers: false,
      providers: true,
      models: false,
    })
  })
})
