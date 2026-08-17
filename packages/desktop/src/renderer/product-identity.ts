import { Product } from "@foreachcode/product"

export function desktopWindowStateKey(windowID: string) {
  return `${Product.profile.identity.directoryName}.desktop.window.${windowID}.last-active-url`
}

export function desktopVisibleVersion(initialization: { version: string }) {
  return initialization.version
}

export const desktopNotificationIcon = "./favicon.png"
