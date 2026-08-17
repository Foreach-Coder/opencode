import ts from "typescript"
import type { BuildIdentity } from "../../../common/types"
import {
  applyVersionEdits,
  collect,
  encodeString,
  parse,
  propertyName,
  removeArrayElement,
  removeObjectProperty,
  replaceNode,
  requireCount,
} from "./ast"

export const localeProductKeys = new Set([
  "desktop.menu.app",
  "desktop.menu.documentation",
  "desktop.menu.ariaLabel",
  "desktop.recovery.loadFailed",
  "desktop.recovery.terminated",
  "desktop.recovery.unresponsive",
  "help.tabs.introduction",
  "home.providerTip",
  "toast.update.description",
  "error.page.report.prefix",
  "error.chain.mcpFailed",
  "app.name.desktop",
  "dialog.model.unpaid.freeModels.title",
  "dialog.server.description",
  "provider.connect.apiKey.description",
  "provider.connect.oauth.auto.visit.suffix",
  "provider.connect.oauth.code.visit.suffix",
  "sidebar.gettingStarted.line1",
  "settings.general.row.language.description",
  "settings.general.row.appearance.description",
  "settings.general.row.colorScheme.description",
  "settings.general.row.theme.description",
  "settings.updates.row.startup.description",
  "settings.updates.toast.latest.description",
  "settings.updates.toast.latest.title",
])

export const localePreservedPrefixes = ["dialog.provider.opencode", "provider.connect.opencodeZen"] as const

export const localePreservedKeys = new Set<string>()

export const localeExcludedPrefixes = ["desktop.wsl.", "wsl.", "settings.desktop.wsl."] as const
export const localeExcludedKeys = new Set(["settings.desktop.section.wsl"])

const positionalLocaleFiles = new Set([
  "packages/app/src/i18n/hr.ts",
  "packages/app/src/i18n/hu.ts",
  "packages/app/src/i18n/is.ts",
  "packages/app/src/i18n/lt.ts",
])

const positionalProductValues = [
  [0, "desktop.menu.app"],
  [40, "desktop.menu.documentation"],
  [44, "desktop.menu.ariaLabel"],
  [57, "desktop.recovery.loadFailed"],
  [58, "desktop.recovery.terminated"],
  [59, "desktop.recovery.unresponsive"],
] as const

const positionalWslValues = Array.from({ length: 19 }, (_, index) => index + 69)

export function transformLocale(file: string, code: string, identity: BuildIdentity) {
  if (file === "packages/app/src/i18n/desktop-native.ts") {
    return transformProductValues(file, code, identity.name, "desktop.menu.app")
  }
  if (!/^packages\/app\/src\/i18n\/[^/]+\.ts$/.test(file)) return { code, records: [] }
  return transformProductValues(file, code, identity.name, "app.name.desktop")
}

function transformProductValues(file: string, code: string, name: string, requiredKey: string) {
  const source = parse(file, code)
  const allProperties = collect(source, ts.isPropertyAssignment)
  const properties = allProperties.filter(
    (node) => localeProductKeys.has(propertyName(node.name) ?? "") && ts.isStringLiteralLike(node.initializer),
  )
  const required = requireCount(
    `locale ${requiredKey}`,
    properties.filter((node) => propertyName(node.name) === requiredKey),
  )
  if (!ts.isStringLiteralLike(required[0].initializer) || !required[0].initializer.text.includes("OpenCode")) {
    throw new Error(`1.18.18 结构 locale ${requiredKey} 原值不包含 OpenCode`)
  }
  const targets = properties.filter(
    (node): node is ts.PropertyAssignment & { initializer: ts.StringLiteralLike } =>
      ts.isStringLiteralLike(node.initializer) && node.initializer.text.includes("OpenCode"),
  )
  const excluded = allProperties.filter((node) => isExcludedLocaleKey(propertyName(node.name)))
  if (!excluded.length) throw new Error(`1.18.18 结构 locale ${requiredKey} 未找到不可达 WSL 文本`)
  const edits = targets.map((node) =>
    replaceNode(
      source,
      node.initializer,
      encodeString(node.initializer.text.replaceAll("OpenCode", name), node.initializer, source),
      `locale ${propertyName(node.name)}`,
    ),
  )
  edits.push(...excluded.map((node) => removeObjectProperty(source, node, `locale ${propertyName(node.name)}`)))
  if (positionalLocaleFiles.has(file)) {
    const desktop = requireCount("locale positional desktop values", findDesktopArrays(source))
    requireCount("locale positional desktop value count", desktop[0].elements, 90)
    positionalProductValues.forEach(([index, key]) => {
      const value = desktop[0].elements[index]
      if (!value || !ts.isStringLiteralLike(value) || !value.text.includes("OpenCode")) {
        throw new Error(`1.18.18 结构 locale positional ${key} 原值不包含 OpenCode`)
      }
      edits.push(
        replaceNode(
          source,
          value,
          encodeString(value.text.replaceAll("OpenCode", name), value, source),
          `locale ${key}`,
        ),
      )
    })
    positionalWslValues.forEach((index) => {
      const value = desktop[0].elements[index]
      if (!value || !ts.isStringLiteralLike(value)) {
        throw new Error(`1.18.18 结构 locale positional WSL ${index} 不是字符串`)
      }
      edits.push(removeArrayElement(source, value, `locale positional WSL ${index}`))
    })
  }
  const result = applyVersionEdits(file, code, edits, "locale-product-identity")
  const transformed = parse(file, result.code)
  const leaked = collect(transformed, ts.isPropertyAssignment).filter(
    (node) =>
      localeProductKeys.has(propertyName(node.name) ?? "") &&
      ts.isStringLiteralLike(node.initializer) &&
      node.initializer.text.includes("OpenCode"),
  )
  if (leaked.length) throw new Error(`1.18.18 locale 产品身份转换后仍有 ${leaked.length} 个 OpenCode 值`)
  const reachableWsl = collect(transformed, ts.isPropertyAssignment).filter((node) =>
    isExcludedLocaleKey(propertyName(node.name)),
  )
  if (reachableWsl.length) throw new Error(`1.18.18 locale 转换后仍有 ${reachableWsl.length} 个 WSL CLI 文本`)
  if (positionalLocaleFiles.has(file)) {
    const desktop = requireCount("locale transformed positional desktop values", findDesktopArrays(transformed))
    requireCount("locale transformed positional desktop value count", desktop[0].elements, 71)
  }
  const unclassified = collect(transformed, ts.isStringLiteralLike).filter((node) => {
    if (!node.text.includes("OpenCode")) return false
    if (!ts.isPropertyAssignment(node.parent) || node.parent.initializer !== node) return true
    return !isPreservedLocaleKey(propertyName(node.parent.name))
  })
  if (unclassified.length) throw new Error(`1.18.18 locale 存在 ${unclassified.length} 个未分类 OpenCode 产品值`)
  return result
}

function isExcludedLocaleKey(key: string | undefined) {
  return (
    key !== undefined &&
    (localeExcludedKeys.has(key) || localeExcludedPrefixes.some((prefix) => key.startsWith(prefix)))
  )
}

function isPreservedLocaleKey(key: string | undefined) {
  return (
    key !== undefined &&
    (localePreservedKeys.has(key) || localePreservedPrefixes.some((prefix) => key.startsWith(prefix)))
  )
}

function findDesktopArrays(source: ts.SourceFile) {
  return collect(source, ts.isVariableDeclaration).flatMap((node) => {
    if (propertyName(node.name) !== "desktop" || !node.initializer || !ts.isArrayLiteralExpression(node.initializer)) {
      return []
    }
    return [node.initializer]
  })
}
