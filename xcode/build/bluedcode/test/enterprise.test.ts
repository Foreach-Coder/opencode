import { describe, expect, test } from "bun:test"
import { assertEnterprisePolicy, enterprisePolicySchema } from "../common/enterprise"
import { enterprisePolicy11818 } from "../version/1.18.18/rules/enterprise-policy"

describe("Enterprise policy", () => {
  test("BluedCode 1.18.18 policy is always enabled and admin-static-only", () => {
    expect(assertEnterprisePolicy(enterprisePolicy11818)).toEqual({
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

  test("policy cannot be disabled or widened by user input", () => {
    expect(() => enterprisePolicySchema.parse({ ...enterprisePolicy11818, enabled: false })).toThrow("enabled")
    expect(() => enterprisePolicySchema.parse({ ...enterprisePolicy11818, providerMode: "user-configurable" })).toThrow(
      "providerMode",
    )
  })
})
