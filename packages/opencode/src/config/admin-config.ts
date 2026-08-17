import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

type IntegrationConfig = Pick<
  ConfigV1.Info,
  "provider" | "model" | "small_model" | "enabled_providers" | "disabled_providers" | "mcp" | "plugin"
>

export type Snapshot = IntegrationConfig & {
  providers: { id: string }[]
}

export type ProviderConfig = Pick<
  Snapshot,
  "provider" | "model" | "small_model" | "enabled_providers" | "disabled_providers"
>

export function load(info: ConfigV1.Info): Snapshot {
  const config: IntegrationConfig = {
    ...(info.provider === undefined ? {} : { provider: structuredClone(info.provider) }),
    ...(info.model === undefined ? {} : { model: info.model }),
    ...(info.small_model === undefined ? {} : { small_model: info.small_model }),
    ...(info.enabled_providers === undefined ? {} : { enabled_providers: structuredClone(info.enabled_providers) }),
    ...(info.disabled_providers === undefined ? {} : { disabled_providers: structuredClone(info.disabled_providers) }),
    ...(info.mcp === undefined ? {} : { mcp: structuredClone(info.mcp) }),
    ...(info.plugin === undefined ? {} : { plugin: structuredClone(info.plugin) }),
  }
  return {
    ...config,
    providers: Object.keys(config.provider ?? {}).map((id) => ({ id })),
  }
}

export function fromSources(input: {
  globalConfig?: ConfigV1.Info
  envConfig?: ConfigV1.Info
  projectConfig?: ConfigV1.Info
}): Snapshot {
  return load(input.globalConfig ?? {})
}

export function providerConfig(snapshot: Snapshot): ProviderConfig {
  const { providers: _providers, mcp: _mcp, plugin: _plugin, ...config } = snapshot
  return config
}

export * as AdminConfig from "./admin-config"
