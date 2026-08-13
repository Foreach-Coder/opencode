import { join } from "node:path"
import { Brand } from "@opencode-ai/brand"
import type { CHANNEL } from "./constants"

type Channel = typeof CHANNEL

export const DESKTOP_APP_NAMES = {
  dev: Brand.desktop.dev.name,
  beta: Brand.desktop.beta.name,
  prod: Brand.desktop.prod.name,
} as const satisfies Record<Channel, string>

export const DESKTOP_APP_IDS = {
  dev: Brand.desktop.dev.appId,
  beta: Brand.desktop.beta.appId,
  prod: Brand.desktop.prod.appId,
} as const satisfies Record<Channel, string>

export const DESKTOP_PROTOCOL = Brand.protocol

export function desktopAppId(channel: Channel, packaged: boolean) {
  return packaged ? DESKTOP_APP_IDS[channel] : DESKTOP_APP_IDS.dev
}

export function desktopUserDataPath(appData: string, channel: Channel, packaged: boolean) {
  return join(appData, desktopAppId(channel, packaged))
}

export function deepLinksFromArgv(argv: string[]) {
  return argv.filter((arg) => arg.startsWith(`${DESKTOP_PROTOCOL}://`))
}
