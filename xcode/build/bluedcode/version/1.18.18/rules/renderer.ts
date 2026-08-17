import type { TransformRule } from "../../../common/transform/types"
import type { BuildIdentity } from "../../../common/types"

/** The HTML document title remains a package-time asset concern. */
export const rendererRules: readonly TransformRule[] = [
  {
    id: "renderer-document-title",
    file: "packages/desktop/src/renderer/index.html",
    kind: "html-text",
    selector: "tag:title.text",
    from: "OpenCode",
    to: "{{identity.name}}",
    expected: 1,
    classification: "product",
    reason: "设置当前 channel 的 Desktop HTML 标题",
  },
]

export const removedRendererRuleIds = [
  "renderer-window-title",
  "renderer-platform-identity",
  "renderer-layout-defaults",
] as const

export function resolveRendererRules(name: string) {
  return rendererRules.map((rule) => ({ ...rule, to: rule.to?.replaceAll("{{identity.name}}", name) }))
}

/** Runtime code now owns product identity and layout defaults. */
export function transformRendererIdentity(_file: string, code: string, _identity: BuildIdentity) {
  return { code, records: [] }
}
