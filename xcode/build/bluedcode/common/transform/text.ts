import type { RuleTransform, TransformRule } from "./types"

export function transformText(code: string, rule: TransformRule): RuleTransform {
  if (rule.kind !== "exact-text" || rule.selector !== "document") {
    throw new Error(`规则 ${rule.id} 使用不支持的 selector: ${rule.selector}`)
  }
  if (!rule.from) throw new Error(`规则 ${rule.id} from 不能为空`)
  const replacements: RuleTransform["replacements"] = []
  let cursor = 0
  while (cursor <= code.length - rule.from.length) {
    const start = code.indexOf(rule.from, cursor)
    if (start === -1) break
    replacements.push({ start, end: start + rule.from.length, text: rule.to ?? "" })
    cursor = start + Math.max(rule.from.length, 1)
  }
  if (replacements.length !== rule.expected) {
    throw new Error(`规则 ${rule.id} 命中 ${replacements.length}，期望 ${rule.expected}`)
  }
  return { hits: replacements.length, replacements }
}
