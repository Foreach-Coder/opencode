import { beforeEach, expect, mock, test } from "bun:test"

const handlers = new Map<string, (...args: any[]) => unknown>()

mock.module("electron", () => ({
  app: {
    getPath: () => "C:\\desktop-data",
    getVersion: () => "stale-electron-version",
    once: () => undefined,
    on: () => undefined,
  },
  BrowserWindow: {
    fromWebContents: () => ({ isDestroyed: () => false, webContents: {} }),
  },
  clipboard: { readImage: () => ({ isEmpty: () => true }) },
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler),
    on: () => undefined,
  },
  shell: {},
}))

mock.module("./draft-store", () => ({
  createDesktopDraftStore: () => ({ flush: () => undefined, close: () => undefined }),
}))

mock.module("./desktop-menu-actions", () => ({ runDesktopMenuAction: () => undefined }))
mock.module("./debug", () => ({ setForceFocus: () => undefined }))
mock.module("./attachment-picker", () => ({
  assertAttachmentBudget: () => undefined,
  createPickedFileAuthorizations: () => ({ add: () => "", read: () => new ArrayBuffer(0), release: () => undefined }),
}))
mock.module("./store", () => ({
  getStore: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined, clear: () => undefined, store: {} }),
  removeStoreFileIfEmpty: () => undefined,
}))
mock.module("./updater-subscriptions", () => ({
  createUpdaterSubscriptions: () => ({ set: () => undefined, delete: () => undefined, clear: () => undefined }),
}))
mock.module("./windows", () => ({
  getPinchZoomEnabled: () => false,
  getWindowID: () => "main",
  openExternalURL: () => undefined,
  openLocalFileURL: () => undefined,
  setPinchZoomEnabled: () => undefined,
  setTitlebar: () => undefined,
  updateTitlebar: () => undefined,
}))

const { registerIpcHandlers } = await import("./ipc")

beforeEach(() => handlers.clear())

test("desktop initialization IPC returns the visible version injected by main", () => {
  registerIpcHandlers({
    visibleVersion: "1.18.18-260816-01-a39a781eb3",
    killSidecar: () => undefined,
    relaunch: () => undefined,
    awaitInitialization: async () => ({ url: "http://127.0.0.1", username: null, password: null }),
    consumeInitialDeepLinks: () => [],
    getDefaultServerUrl: () => null,
    setDefaultServerUrl: () => undefined,
    isFirstLaunchOnboardingPending: () => false,
    finishFirstLaunchOnboarding: () => null,
    isOldLayoutEligible: () => false,
    getDisplayBackend: async () => null,
    setDisplayBackend: () => undefined,
    checkAppExists: () => false,
    resolveAppPath: async () => null,
    updater: { subscribe: () => () => undefined, check: async () => ({}), install: async () => undefined },
    showUpdater: () => undefined,
    setBackgroundColor: () => undefined,
    exportDebugLogs: async () => "",
    recordFatalRendererError: () => undefined,
    setNativeTranslations: () => undefined,
  } as any)

  const handler = handlers.get("get-desktop-initialization")
  expect(handler).toBeDefined()
  expect(handler?.({ sender: {} })).toEqual({ id: "main", version: "1.18.18-260816-01-a39a781eb3" })
})
