import type { AuditPolicy } from "../../common/audit"
import { Product } from "../../../../../packages/product/src"
import { deriveBuildTargets, deriveFingerprints, findModule, type ModuleContract, type VersionAdapter } from "../../common/adapter"
import { registerVersionAdapter } from "../../common/adapter-registry"
import type { BuildIdentity } from "../../common/types"
import { transformModule } from "../../common/transform/engine"
import type { TransformResult, TransformRule } from "../../common/transform/types"
import baselineData from "./baseline.json"
import { assetRules, desktopAssetPolicy } from "./rules/assets"
import { transformLocale } from "./rules/locales"
import { auditPolicy, preservedIdentities } from "./rules/preserved-identities"
import { rendererRules, resolveRendererRules } from "./rules/renderer"
import { sha256 } from "./rules/ast"
import { resourceEditorLock } from "./resource-editor-lock"

const productProfileSha256 = sha256(JSON.stringify(Product.profile))

const fingerprints: Readonly<Record<string, string>> = baselineData.fingerprints
const rules = [...rendererRules, ...assetRules]
const modules: readonly ModuleContract[] = [
  {
    id: "server:bundle",
    file: "packages/opencode/src/node.ts",
    stage: "server",
    fingerprint: fingerprints["packages/opencode/src/node.ts"]!,
    rules: [],
  },
  ...Object.keys(fingerprints)
    .filter((file) => file.startsWith("packages/app/src/i18n/"))
    .map((file) => ({
      id: `locale:${file.slice("packages/app/src/i18n/".length, -3)}`,
      file,
      stage: "renderer" as const,
      fingerprint: fingerprints[file]!,
      rules: [],
    })),
  {
    id: "locale:desktop-native:main",
    file: "packages/app/src/i18n/desktop-native.ts",
    stage: "main",
    fingerprint: fingerprints["packages/app/src/i18n/desktop-native.ts"]!,
    rules: [],
  },
  {
    id: "preload:contract",
    file: "packages/desktop/src/preload/index.ts",
    stage: "preload",
    fingerprint: fingerprints["packages/desktop/src/preload/index.ts"]!,
    rules: [],
  },
  {
    id: "renderer:contract",
    file: "packages/desktop/src/renderer/index.tsx",
    stage: "renderer",
    fingerprint: fingerprints["packages/desktop/src/renderer/index.tsx"]!,
    rules: [],
  },
  ...[...new Set(rules.map((rule) => rule.file))].map((file) => ({
    id: `static:${file.slice("packages/".length).replaceAll("/", ":").replaceAll(".", "-")}`,
    file,
    stage: "renderer" as const,
    fingerprint: fingerprints[file]!,
    rules: rules.filter((rule) => rule.file === file),
  })),
]
assertControlledTargets(modules)

export const version11818Adapter: VersionAdapter = {
  tag: baselineData.tag,
  commit: baselineData.commit,
  desktopVersion: "1.18.18",
  modules,
  fingerprints: deriveFingerprints({ modules }),
  rules: modules.flatMap((module) => module.rules),
  hookTargets: deriveBuildTargets({ modules }).map((target) => target.file),
  auditPolicy,
  preservedIdentities,
  assets: desktopAssetPolicy,
  resourceEditorTool: resourceEditorLock,
  productProfileSha256,
  transform(file, code, identity, stage: ModuleContract["stage"] = "renderer") {
    const normalized = normalizePath(file)
    const module = findModule({ modules }, normalized, stage)
    if (!module) return { code, records: [] }
    const digest = sha256(code)
    if (digest !== module.fingerprint) {
      throw new Error(`1.18.18 受控文件语义指纹不匹配：${normalized} expected=${module.fingerprint} actual=${digest}`)
    }
    return transformControlled(normalized, code, identity, stage)
  },
}

registerVersionAdapter(version11818Adapter)

/** @deprecated 仅保留给既有版本专用测试；公共流程必须通过 registry 选择适配器。 */
export const adapter11818 = version11818Adapter

function transformControlled(
  file: string,
  code: string,
  identity: BuildIdentity,
  stage: ModuleContract["stage"],
): TransformResult {
  const selected =
    stage === "renderer"
      ? [...resolveRendererRules(identity.name), ...assetRules].filter((rule) => normalizePath(rule.file) === file)
      : []
  const declared = selected.length ? transformModule({ file, code }, selected) : { code, records: [] }
  const locale =
    stage === "renderer" || stage === "main"
      ? transformLocale(file, declared.code, identity)
      : { code: declared.code, records: [] }
  const records = [...declared.records, ...locale.records]
  return {
    code: locale.code,
    records: records.length
      ? records
      : [{ id: "build-contract-audit", file, kind: "evidence", hits: 1, before: sha256(code), after: sha256(code) }],
  }
}

function normalizePath(file: string) {
  return file.replaceAll("\\", "/")
}

function assertControlledTargets(targets: readonly ModuleContract[]) {
  const missing = targets.filter((module) => !module.fingerprint).map((module) => module.file)
  if (missing.length) throw new Error(`1.18.18 适配器目标缺少受控指纹：${missing.join(", ")}`)
}
