import { app } from "electron"
import { createUpdaterController } from "./updater-controller"
import { assertDesktopCapability } from "./product-capability"

export function createDisabledAutoUpdater(stop: () => Promise<void>) {
  return createUpdaterController({
    enabled: false,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: async () => null,
      downloadUpdate: async () => undefined,
      quitAndInstall: () => undefined,
    },
    persistence: { get: () => undefined, set: () => undefined, clear: () => undefined },
    stop,
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof createDisabledAutoUpdater>, _alertOnFail: boolean) {
  assertDesktopCapability("updater")
  await controller.check()
}
