import type { VersionAdapter } from "./adapter"

export type VersionAdapterSelection = {
  tag: string
  commit: string
  desktopVersion: string
}

const registered = new Map<string, VersionAdapter>()

export function registerVersionAdapter(adapter: VersionAdapter): VersionAdapter {
  const key = adapterKey(adapter)
  const existing = registered.get(key)
  if (existing && existing !== adapter) throw new Error(`VersionAdapter 重复注册: ${adapter.tag}`)
  registered.set(key, adapter)
  return adapter
}

export function selectVersionAdapter(input: VersionAdapterSelection): VersionAdapter {
  const adapter = registered.get(adapterKey(input))
  if (!adapter) {
    throw new Error(
      `未注册的 VersionAdapter: tag=${input.tag} commit=${input.commit} desktopVersion=${input.desktopVersion}`,
    )
  }
  return adapter
}

function adapterKey(input: VersionAdapterSelection) {
  return `${input.tag}\0${input.commit}\0${input.desktopVersion}`
}
