import { assertEnterprisePolicy } from "../../../common/enterprise"

export const enterprisePolicy11818 = assertEnterprisePolicy({
  enabled: true,
  providerMode: "admin-static-only",
  blockedAuthWrites: true,
  blockedPublicShare: true,
  blockedPublicCatalogRefresh: true,
  blockedTelemetry: true,
  blockedPublicUpdates: true,
  blockedPublicProductLinks: true,
})
