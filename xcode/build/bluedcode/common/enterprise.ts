export type EnterprisePolicy = {
  enabled: true
  providerMode: "admin-static-only"
  blockedAuthWrites: true
  blockedPublicShare: true
  blockedPublicCatalogRefresh: true
  blockedTelemetry: true
  blockedPublicUpdates: true
  blockedPublicProductLinks: true
}

export const enterprisePolicySchema = {
  parse(input: unknown): EnterprisePolicy {
    if (!input || typeof input !== "object") throw new Error("enterprise policy 必须是对象")
    const value = input as Record<string, unknown>
    const exact: EnterprisePolicy = {
      enabled: true,
      providerMode: "admin-static-only",
      blockedAuthWrites: true,
      blockedPublicShare: true,
      blockedPublicCatalogRefresh: true,
      blockedTelemetry: true,
      blockedPublicUpdates: true,
      blockedPublicProductLinks: true,
    }
    for (const [key, expected] of Object.entries(exact)) {
      if (value[key] !== expected) throw new Error(`enterprise policy ${key} 必须固定为 ${String(expected)}`)
    }
    return exact
  },
}

export function assertEnterprisePolicy(input: unknown) {
  return enterprisePolicySchema.parse(input)
}
