import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { Effect } from "effect"

export function adminPluginOrigins(config: Pick<Config.Interface, "getAdminIntegrations">) {
  return Effect.map(config.getAdminIntegrations(), (snapshot): ConfigPlugin.Origin[] =>
    (snapshot.plugin ?? []).map((spec) => ({ spec, source: "admin", scope: "global" })),
  )
}

export const runtimePluginOrigins = adminPluginOrigins
export const initializePluginRegistry = runtimePluginOrigins

export * as PluginAdmin from "./admin"
