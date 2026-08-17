import type { Product } from "@foreachcode/product"

type Provider = {
  managedBy?: unknown
  configurableByUser?: unknown
}

export const ProductUiRegistry = {
  surface(profile: Product.ProductProfile) {
    const localPreferences = Object.fromEntries(
      profile.localPreferences.map((preference) => [
        preference,
        profile.operations["config.write.preference"] === "allow",
      ]),
    ) as Record<(typeof profile.localPreferences)[number], boolean>
    const providerActions = this.providerActions(profile, {})

    return {
      settings: {
        general: profile.operations["config.write.preference"] === "allow",
        providers: providerSettings(profile),
      },
      providerActions,
      localPreferences,
      publicActions: {
        share: profile.operations["share.public"] === "allow",
        update: profile.operations["update.public"] === "allow",
      },
    }
  },

  providerActions(profile: Product.ProductProfile, provider: Provider) {
    if (profile.operations["provider.manage"] !== "allow") return disabledProviderActions()
    if (provider.managedBy === "admin" || provider.configurableByUser === false) return disabledProviderActions()
    return { connect: true, configure: true, disconnect: true }
  },

  localPreferences(profile: Product.ProductProfile) {
    return this.surface(profile).localPreferences
  },

  settingsTabs(profile: Product.ProductProfile) {
    const surface = this.surface(profile)
    return {
      general: surface.settings.general,
      shortcuts: surface.localPreferences.keybinds,
      servers: profile.operations["mcp.manage"] === "allow",
      providers: surface.settings.providers !== "hidden",
      models: profile.operations["provider.manage"] === "allow",
    }
  },

  desktopEntries(profile: Product.ProductProfile) {
    const surface = this.surface(profile)
    return {
      updater: surface.publicActions.update,
      cli: false,
      wsl: false,
      share: surface.publicActions.share,
      help: false,
    }
  },
}

function providerSettings(profile: Product.ProductProfile) {
  if (profile.operations["provider.read"] === "allow-admin-static") return "readonly-admin" as const
  if (profile.operations["provider.manage"] === "allow") return "configurable" as const
  return "hidden" as const
}

function disabledProviderActions() {
  return { connect: false, configure: false, disconnect: false }
}
