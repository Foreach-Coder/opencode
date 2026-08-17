import { describe, expect, test } from "bun:test"
import { Product } from "../../../../packages/product/src"
import { enterprisePolicyFromProfile } from "../common/manifest"
import { adapter11818 } from "../version/1.18.18"

describe("Enterprise policy", () => {
  test("manifest 企业策略只能由产品 Profile operations 投影", () => {
    expect(enterprisePolicyFromProfile(Product.profile.operations)).toEqual({
      enabled: true,
      providerMode: "admin-static-only",
      blockedAuthWrites: true,
      blockedPublicShare: true,
      blockedPublicCatalogRefresh: true,
      blockedTelemetry: true,
      blockedPublicUpdates: true,
      blockedPublicProductLinks: true,
    })
  })

  test("版本适配器不保留可独立编辑的企业策略 literal", () => {
    expect("enterprisePolicy" in adapter11818).toBe(false)
  })
})
