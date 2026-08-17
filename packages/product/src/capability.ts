import { errorCodeForOperation, messageForOperation, ProductError } from "./error"
import type { ProductCapability, ProductOperation, ProductProfile } from "./profile"

export function assertCapability(profile: ProductProfile, capability: ProductCapability) {
  const operation = operationForCapability(capability)
  if (operation) {
    authorize(profile, operation)
    return
  }
  if (profile.capabilities[capability]) return
  throw new ProductError("PRODUCT_CAPABILITY_DISABLED", `产品能力 ${capability} 已禁用`)
}

export function authorize(profile: ProductProfile, operation: ProductOperation) {
  const decision = profile.operations[operation]
  if (decision === "allow" || decision === "allow-admin-static") return { decision }
  throw new ProductError(errorCodeForOperation(operation), messageForOperation(operation))
}

function operationForCapability(capability: ProductCapability): ProductOperation | undefined {
  if (capability === "updater") return "update.public"
  if (capability === "publicShare") return "share.public"
  if (capability === "telemetry") return "telemetry"
  if (capability === "publicProviderCatalog") return "catalog.public"
}
