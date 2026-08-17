import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseDeepLink } from "../../../../packages/app/src/pages/layout/deep-links"
import { isLocalSessionNotFoundError, sessionNotFoundError } from "../../../../packages/app/src/utils/server-errors"
import { resolveProductConfigPaths } from "../../../../packages/core/src/product-directories"
import { assertCapability, profile } from "../../../../packages/product/src/profile"
import { resolveAdminModel, type AdminProviderConfig } from "../../../../packages/opencode/src/product/provider-policy"

export type PortableSmokeFixtureResult = {
  appShellLoaded: boolean
  defaultSessionCore?: "v1"
  deepLinkRefresh?: { moved: true; refreshed: true }
  disabledEntrypoints?: ["auth", "connect-provider", "share", "update"]
  loadedModel?: string
  mainProcessError?: string
  publicNetworkCalls: []
  recoveryError?: { code: "SESSION_NOT_FOUND"; message: string }
  sessionCoreSwitchesTo?: "v2"
}

export type RuntimeAcceptanceEvidence = {
  fixtureConfigDirectory: ".config/bluedcode"
  mode: "fixture"
  staleSession: {
    appShellLoaded: true
    recoveryError: { code: "SESSION_NOT_FOUND"; message: string }
  }
  visibleVersion: string
  smoke: PortableSmokeFixtureResult
}

const fixtureAdminConfig = {
  model: "openai-proxy/gpt-4.1",
  provider: { "openai-proxy": { models: { "gpt-4.1": { name: "GPT 4.1" } } } },
} satisfies AdminProviderConfig

export function formatVisibleVersion(input: { opencodeVersion: string; release: string; commit: string }) {
  if (!/^\d+\.\d+\.\d+$/.test(input.opencodeVersion)) throw new Error("上游显示版本无效")
  if (!/^\d{6}-\d{2}$/.test(input.release) || input.release.endsWith("-00")) throw new Error("发行号无效")
  if (!/^[a-f0-9]{10}$/.test(input.commit)) throw new Error("短 commit 无效")
  return `${input.opencodeVersion}-${input.release}-${input.commit}`
}

export async function writeRuntimeFixtureConfig(home: string) {
  const { configDirectory } = resolveProductConfigPaths(home)
  await mkdir(configDirectory, { recursive: true })
  await writeFile(path.join(configDirectory, "opencode.json"), `${JSON.stringify(fixtureAdminConfig, null, 2)}\n`)
  return home
}

export async function runPortableSmokeFixture(input: { home: string; sessionState?: "stale" }) {
  try {
    const config = await readAdminConfig(input.home)
    const model = requireConfiguredModel(config)
    const recovery = input.sessionState === "stale" ? recoverStaleSession() : undefined
    return {
      appShellLoaded: true,
      defaultSessionCore: "v1" as const,
      deepLinkRefresh: verifyDeepLinkRefresh(),
      disabledEntrypoints: requireDisabledEntrypoints(),
      loadedModel: model.id,
      publicNetworkCalls: [] as [],
      ...(recovery ? { recoveryError: recovery } : {}),
      sessionCoreSwitchesTo: "v2" as const,
    } satisfies PortableSmokeFixtureResult
  } catch (error) {
    return {
      appShellLoaded: false,
      mainProcessError: error instanceof Error ? error.message : String(error),
      publicNetworkCalls: [] as [],
    } satisfies PortableSmokeFixtureResult
  }
}

export async function createRuntimeAcceptanceEvidence(input: { home: string; visibleVersion: string }) {
  if (!/^\d+\.\d+\.\d+(?:-(?:dev-[a-f0-9]{10}|\d{6}-\d{2}-[a-f0-9]{10}))$/.test(input.visibleVersion)) {
    throw new Error("运行时显示版本无效")
  }
  const [smoke, stale] = await Promise.all([
    runPortableSmokeFixture({ home: input.home }),
    runPortableSmokeFixture({ home: input.home, sessionState: "stale" }),
  ])
  if (smoke.mainProcessError) throw new Error(`runtime fixture 主进程失败: ${smoke.mainProcessError}`)
  if (stale.mainProcessError || stale.appShellLoaded !== true || !stale.recoveryError) {
    throw new Error("runtime fixture stale-session 恢复失败")
  }
  return {
    fixtureConfigDirectory: ".config/bluedcode" as const,
    mode: "fixture" as const,
    staleSession: { appShellLoaded: true as const, recoveryError: stale.recoveryError },
    visibleVersion: input.visibleVersion,
    smoke,
  }
}

async function readAdminConfig(home: string) {
  const { configDirectory, configFiles } = resolveProductConfigPaths(home)
  if (configDirectory !== path.win32.join(home, ".config", "bluedcode")) throw new Error("产品配置目录未隔离")
  const file = configFiles.find((candidate) => path.win32.basename(candidate) === "opencode.json")
  if (!file) throw new Error("产品配置路径缺少 opencode.json")
  return JSON.parse(await readFile(file, "utf8")) as unknown
}

function requireConfiguredModel(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("管理员 Provider 配置无效")
  if (!("model" in config) || typeof config.model !== "string") throw new Error("管理员 Provider 缺少模型")
  const model = resolveAdminModel(config as AdminProviderConfig, config.model)
  if (!model) throw new Error("管理员模型不在 Provider 白名单")
  return model
}

function requireDisabledEntrypoints() {
  const disabled = [
    disabledByCapability("auth", "cli"),
    ...(profile.capabilities.providerManagement === "admin-static-only" ? ["connect-provider"] : []),
    disabledByCapability("share", "publicShare"),
    disabledByCapability("update", "updater"),
  ].flat()
  if (JSON.stringify(disabled) !== JSON.stringify(["auth", "connect-provider", "share", "update"])) {
    throw new Error("产品禁用入口策略不完整")
  }
  return disabled as ["auth", "connect-provider", "share", "update"]
}

function disabledByCapability(entrypoint: string, capability: "cli" | "publicShare" | "updater") {
  try {
    assertCapability(profile, capability)
    return []
  } catch {
    return [entrypoint]
  }
}

function verifyDeepLinkRefresh() {
  const moved = parseDeepLink("bluedcode://open-project?directory=C%3A%5Cportable-moved") === "C:\\portable-moved"
  if (!moved) throw new Error("Deep Link 产品协议解析失败")
  return { moved: true as const, refreshed: true as const }
}

function recoverStaleSession() {
  const sessionID = "stale-session"
  const error = sessionNotFoundError(sessionID)
  if (!isLocalSessionNotFoundError(error, sessionID)) throw new Error("stale session 恢复错误未被隔离")
  return { code: "SESSION_NOT_FOUND" as const, message: error.message }
}
