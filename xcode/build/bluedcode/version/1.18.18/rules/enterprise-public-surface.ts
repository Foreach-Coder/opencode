import ts from "typescript"
import {
  applyVersionEdits,
  assertAbsent,
  collect,
  importModule,
  parse,
  propertyName,
  removeImportSpecifier,
  removeNode,
  replaceNode,
  requireCount,
  type VersionEdit,
} from "./ast"

const mainFile = "packages/desktop/src/main/index.ts"
const ipcFile = "packages/desktop/src/main/ipc.ts"
const preloadFile = "packages/desktop/src/preload/index.ts"
const preloadTypesFile = "packages/desktop/src/preload/types.ts"
const rendererFile = "packages/desktop/src/renderer/index.tsx"
const entryFile = "packages/app/src/entry.tsx"
const appFile = "packages/app/src/app.tsx"
const highlightsFile = "packages/app/src/context/highlights.tsx"
const menuFile = "packages/app/src/desktop-menu.ts"
const settingsFile = "packages/app/src/components/settings-general.tsx"
const settingsV2File = "packages/app/src/components/settings-v2/general.tsx"
const titlebarFile = "packages/app/src/components/titlebar.tsx"
const errorPageFile = "packages/app/src/pages/error.tsx"
const layoutPageFile = "packages/app/src/pages/layout.tsx"
const homeProjectsControllerFile = "packages/app/src/pages/home/home-projects-controller.tsx"

export const enterprisePublicSurfaceTargets = [
  mainFile,
  ipcFile,
  preloadFile,
  preloadTypesFile,
  rendererFile,
  entryFile,
  appFile,
  highlightsFile,
  menuFile,
  settingsFile,
  settingsV2File,
  titlebarFile,
  errorPageFile,
  layoutPageFile,
  homeProjectsControllerFile,
] as const

export function transformEnterprisePublicSurface(file: string, code: string) {
  if (file === rendererFile || file === entryFile) return removeSentryInit(file, code)
  if (file === appFile) return removeSentryCapture(code)
  if (file === highlightsFile) return disableHighlights(code)
  if (file === menuFile) return removePublicMenu(code)
  if (file === settingsFile || file === settingsV2File) return removeUpdateSettings(file, code)
  if (file === titlebarFile) return removeTitlebarUpdate(code)
  if ([errorPageFile, layoutPageFile, homeProjectsControllerFile].includes(file)) return disableFeedback(file, code)
  if (
    [mainFile, ipcFile, preloadFile, preloadTypesFile].includes(file as (typeof enterprisePublicSurfaceTargets)[number])
  ) {
    assertAbsent(code, {
      "企业 updater 初始化": "setupAutoUpdater",
    })
  }
  return { code, records: [] }
}

function disableFeedback(file: string, code: string) {
  const source = parse(file, code)
  const call = requireCount(
    "企业 desktop feedback",
    collect(source, ts.isCallExpression).filter(
      (node) =>
        node.expression.getText(source) === "platform.openExternal" &&
        node.arguments.some(
          (argument) => ts.isStringLiteralLike(argument) && argument.text === "https://opencode.ai/desktop-feedback",
        ),
    ),
  )[0]
  return applyVersionEdits(
    file,
    code,
    [replaceNode(source, call, "undefined", "企业 desktop feedback disabled")],
    "enterprise.publicSurface.feedback-disabled",
  )
}

function removeSentryInit(file: typeof rendererFile | typeof entryFile, code: string) {
  const source = parse(file, code)
  const sentryImport = requireCount(
    "企业 Sentry import",
    collect(source, ts.isImportDeclaration).filter((node) => importModule(node) === "@sentry/solid"),
  )[0]
  const init = requireCount(
    "企业 Sentry init",
    collect(source, ts.isIfStatement).filter((node) => node.thenStatement.getText(source).includes("Sentry.init(")),
  )[0]
  requireCount(
    "企业 Sentry init 调用",
    collect(source, ts.isCallExpression).filter((node) => node.expression.getText(source) === "Sentry.init"),
  )
  const edits: VersionEdit[] = [
    removeNode(source, sentryImport, "企业 Sentry import"),
    removeNode(source, init, "企业 Sentry init"),
  ]
  if (file === rendererFile) {
    const pkg = requireCount(
      "企业 desktop Sentry package import",
      collect(source, ts.isImportDeclaration).filter((node) => importModule(node) === "../../package.json"),
    )[0]
    edits.push(removeNode(source, pkg, "企业 desktop Sentry package import"))
  }
  return applyVersionEdits(file, code, edits, "enterprise.publicSurface.telemetry-disabled")
}

function removeSentryCapture(code: string) {
  const source = parse(appFile, code)
  const sentryImport = requireCount(
    "企业 app Sentry import",
    collect(source, ts.isImportDeclaration).filter((node) => importModule(node) === "@sentry/solid"),
  )[0]
  const capture = requireCount(
    "企业 app Sentry capture",
    collect(source, ts.isExpressionStatement).filter((node) =>
      node.getText(source).includes("Sentry.captureException("),
    ),
  )[0]
  return applyVersionEdits(
    appFile,
    code,
    [
      removeNode(source, sentryImport, "企业 app Sentry import"),
      removeNode(source, capture, "企业 app Sentry capture"),
    ],
    "enterprise.publicSurface.telemetry-disabled",
  )
}

function disableHighlights(code: string) {
  const source = parse(highlightsFile, code)
  requireCount(
    "企业 changelog URL",
    collect(source, ts.isStringLiteralLike).filter((node) => node.text === "https://opencode.ai/changelog.json"),
  )
  return applyVersionEdits(
    highlightsFile,
    code,
    [
      replaceNode(
        source,
        source,
        'import { createSimpleContext } from "@opencode-ai/ui/context"\n\nexport const { use: useHighlights, provider: HighlightsProvider } = createSimpleContext({\n  name: "Highlights",\n  gate: false,\n  init: () => ({ ready: () => true, from: () => undefined, to: () => undefined, last: undefined, markSeen: () => undefined }),\n})\n',
        "企业 changelog disabled",
      ),
    ],
    "enterprise.publicSurface.changelog-disabled",
  )
}

function removePublicMenu(code: string) {
  const source = parse(menuFile, code)
  const help = requireCount(
    "企业公共帮助菜单",
    collect(source, ts.isObjectLiteralExpression).filter((node) =>
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          propertyName(property.name) === "id" &&
          property.initializer.getText(source) === '"help"',
      ),
    ),
  )[0]
  return applyVersionEdits(
    menuFile,
    code,
    [removeNode(source, help, "企业公共帮助菜单")],
    "enterprise.publicSurface.links-disabled",
  )
}

function removeUpdateSettings(file: typeof settingsFile | typeof settingsV2File, code: string) {
  const source = parse(file, code)
  const updaterImport = requireCount(
    "企业更新设置 import",
    collect(source, ts.isImportDeclaration).filter(
      (node) => importModule(node) === (file === settingsFile ? "./updater-action" : "../updater-action"),
    ),
  )[0]
  const updater = requireCount(
    "企业更新设置 state",
    collect(source, ts.isVariableDeclaration).filter((node) => node.name.getText(source) === "updater"),
  )[0]
  const section = requireCount(
    "企业更新设置区块",
    collect(source, ts.isVariableDeclaration).filter((node) => node.name.getText(source) === "UpdatesSection"),
  )[0]
  const updateUse = requireCount(
    "企业更新设置渲染",
    collect(
      source,
      (node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
        (file === settingsFile &&
          ts.isJsxSelfClosingElement(node) &&
          node.tagName.getText(source) === "UpdatesSection") ||
        (file === settingsV2File &&
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(source) === "Show" &&
          node.getText(source).includes("UpdatesSection")),
    ),
  )[0]
  return applyVersionEdits(
    file,
    code,
    [
      removeNode(source, updaterImport, "企业更新设置 import"),
      removeNode(source, updater.parent.parent, "企业更新设置 state"),
      removeNode(source, section.parent.parent, "企业更新设置区块"),
      removeNode(source, updateUse, "企业更新设置渲染"),
    ],
    "enterprise.publicSurface.update-settings-disabled",
  )
}

function removeTitlebarUpdate(code: string) {
  const source = parse(titlebarFile, code)
  const updateState = requireCount(
    "企业 titlebar 更新 state",
    collect(source, ts.isVariableDeclaration).filter((node) => node.name.getText(source) === "updateState"),
  )[0]
  const v2RightState = requireCount(
    "企业 titlebar 更新右侧 state",
    collect(source, ts.isVariableDeclaration).filter((node) => node.name.getText(source) === "v2RightState"),
  )[0]
  const types = ["TitlebarUpdatePillState", "TitlebarV2RightState"].map(
    (name) =>
      requireCount(
        "企业 titlebar 更新类型",
        collect(source, ts.isTypeAliasDeclaration).filter((node) => node.name.text === name),
      )[0],
  )
  const right = requireCount(
    "企业 titlebar 更新入口",
    collect(source, ts.isFunctionDeclaration).filter((node) => node.name?.text === "TitlebarV2Right"),
  )[0]
  const button = requireCount(
    "企业 titlebar 更新按钮",
    collect(source, ts.isFunctionDeclaration).filter((node) => node.name?.text === "TitlebarUpdateIconButton"),
  )[0]
  const rightUse = requireCount(
    "企业 titlebar 更新组件渲染",
    collect(source, ts.isJsxSelfClosingElement).filter((node) => node.tagName.getText(source) === "TitlebarV2Right"),
  )[0]
  return applyVersionEdits(
    titlebarFile,
    code,
    [
      removeNode(source, updateState.parent.parent, "企业 titlebar 更新 state"),
      removeNode(source, v2RightState.parent.parent, "企业 titlebar 更新右侧 state"),
      ...types.map((node) => removeNode(source, node, "企业 titlebar 更新类型")),
      replaceNode(
        source,
        right,
        'function TitlebarV2Right() { return <div id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" /> }',
        "企业 titlebar 更新入口",
      ),
      removeNode(source, button, "企业 titlebar 更新按钮"),
      replaceNode(source, rightUse, "<TitlebarV2Right />", "企业 titlebar 更新组件渲染"),
    ],
    "enterprise.publicSurface.titlebar-update-disabled",
  )
}
