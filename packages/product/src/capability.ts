import { ProductError } from "./error"
import type { ProductProfile } from "./profile"

type Capability = {
  [Key in keyof ProductProfile["capabilities"]]: ProductProfile["capabilities"][Key] extends boolean ? Key : never
}[keyof ProductProfile["capabilities"]]

export function assertCapability(profile: ProductProfile, capability: Capability) {
  if (profile.capabilities[capability]) return
  throw new ProductError(
    capability === "publicShare"
      ? "PUBLIC_SHARE_DISABLED"
      : capability === "updater"
        ? "PUBLIC_UPDATE_DISABLED"
        : "PRODUCT_CAPABILITY_DISABLED",
    `产品能力 ${capability} 已禁用`,
  )
}
