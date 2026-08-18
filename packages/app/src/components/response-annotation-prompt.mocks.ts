export const useSDK = () => () => ({ directory: "/repo", client: {}, api: {}, url: "http://fixture.invalid" })

export const useSync = () => () => ({
  data: {
    session_diff: {},
    session_working: () => false,
    message: {},
    reference: [],
    mcp_resource: {},
    command: [],
  },
  session: { get: () => undefined },
})

export const useFile = () => ({
  pathFromTab: () => undefined,
  tab: (path: string) => path,
  load: async () => undefined,
  searchFilesAndDirectories: async () => [],
})

export const selectionFromLines = () => undefined

export const useLayout = () => ({ fileTree: { setTab: () => undefined }, handoff: { setTabs: () => undefined } })

export const useComments = () => ({
  all: () => [],
  replace: () => undefined,
  remove: () => undefined,
  setActive: () => undefined,
  setFocus: () => undefined,
  focus: () => undefined,
})

export const useDialog = () => ({ active: undefined, show: () => undefined })

export const useCommand = () => ({
  options: [],
  register: () => undefined,
  keybind: () => "",
  keybindParts: () => [],
  trigger: () => undefined,
})

export const usePermission = () => ({ isAutoAccepting: () => false, isAutoAcceptingDirectory: () => false })

export const useLanguage = () => ({ t: (key: string) => key })

export const usePlatform = () => ({ platform: "web", fetch })

export const usePrompt = () => {
  throw new Error("fixture must pass PromptInput.state")
}

export const createSessionTabs = () => ({ activeFileTab: () => undefined })

export const createPromptSubmit = () => ({ abort: () => undefined, handleSubmit: async () => undefined })
export const createPersistedPromptInputHistory = () => ({ entries: () => [], add: () => undefined })
export const showToast = () => undefined

export function ModelSelectorPopover() {
  return null
}

export function ModelSelectorPopoverV2() {
  return null
}

export function DialogSelectModelUnpaid() {
  return null
}

export function DialogSelectModelUnpaidV2() {
  return null
}
