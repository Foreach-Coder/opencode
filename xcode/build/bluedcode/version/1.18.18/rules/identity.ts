/** Product identity now comes from @foreachcode/product at runtime; this adapter only audits it. */
export const removedProductIdentityRuleIds = [
  "desktop-app-name",
  "desktop-app-id",
  "desktop-deep-link-filter",
  "desktop-deep-link-registration",
  "renderer-deep-link-filter",
] as const
