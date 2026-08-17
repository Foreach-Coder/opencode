type ProviderModel = {
  name?: string
}

type ProviderConfig = {
  npm?: string
  name?: string
  options?: Record<string, unknown>
  models?: Record<string, ProviderModel>
}

export type AdminProviderConfig = {
  provider?: Record<string, ProviderConfig>
  model?: string
}

export type AdminModel = {
  id: string
  name: string
}

export type AdminProvider = {
  id: string
  name: string
  managedBy: "admin"
  configurableByUser: false
  models: AdminModel[]
}

export function listAdminProviders(config: AdminProviderConfig): AdminProvider[] {
  return Object.entries(config.provider ?? {}).map(([providerID, provider]) => ({
    id: providerID,
    name: provider.name ?? providerID,
    managedBy: "admin" as const,
    configurableByUser: false as const,
    models: Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
      id: `${providerID}/${modelID}`,
      name: model.name ?? modelID,
    })),
  }))
}

export function resolveAdminModel(config: AdminProviderConfig, modelID: string) {
  return listAdminProviders(config)
    .flatMap((provider) => provider.models)
    .find((model) => model.id === modelID)
}

export * as ProviderPolicy from "./provider-policy"
