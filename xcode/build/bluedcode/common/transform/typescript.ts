import ts from "typescript"
import type { Replacement, RuleTransform, TransformRule } from "./types"

type Target = {
  current: string
  replacement: Replacement
}

export function transformTypescript(file: string, code: string, rule: TransformRule): RuleTransform {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind(file))
  const targets = locateTargets(source, rule)
  requireExpected(rule, targets.length)
  const changed = targets.find((target) => target.current !== rule.from)
  if (changed) throw new Error(`规则 ${rule.id} 原值不匹配：实际为 ${JSON.stringify(changed.current)}`)
  return { hits: targets.length, replacements: targets.map((target) => target.replacement) }
}

function locateTargets(source: ts.SourceFile, rule: TransformRule): Target[] {
  const variable = /^variable:([A-Za-z_$][\w$]*)\.property:([A-Za-z_$][\w$]*)$/.exec(rule.selector)
  const property = /^property:([A-Za-z_$][\w$]*)$/.exec(rule.selector)
  const argument = /^call:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.argument:(\d+)$/.exec(rule.selector)
  const call = /^call:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(rule.selector)

  if (variable && (rule.kind === "ts-string" || rule.kind === "ts-remove-property")) {
    return properties(source, variable[2], variable[1]).map((node) => propertyTarget(source, node, rule))
  }
  if (property && (rule.kind === "ts-string" || rule.kind === "ts-remove-property")) {
    return properties(source, property[1]).map((node) => propertyTarget(source, node, rule))
  }
  if (argument && rule.kind === "ts-string") {
    return calls(source, argument[1]).flatMap((node) => {
      const value = node.arguments[Number(argument[2])]
      if (!value || !ts.isStringLiteralLike(value)) return []
      return [stringTarget(source, value, requireTo(rule))]
    })
  }
  if (call && rule.kind === "ts-remove-call") {
    return calls(source, call[1]).map((node) => callTarget(source, node))
  }
  throw new Error(`规则 ${rule.id} 使用不支持的 selector: ${rule.selector}`)
}

function properties(source: ts.SourceFile, name: string, variable?: string) {
  const matches: ts.PropertyAssignment[] = []
  visit(source)
  return matches

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node) && (!variable || belongsToVariable(node, variable))) {
      matches.push(
        ...node.properties.filter(
          (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name,
        ),
      )
    }
    ts.forEachChild(node, visit)
  }
}

function calls(source: ts.SourceFile, callee: string) {
  const matches: ts.CallExpression[] = []
  visit(source)
  return matches

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee) matches.push(node)
    ts.forEachChild(node, visit)
  }
}

function propertyTarget(source: ts.SourceFile, node: ts.PropertyAssignment, rule: TransformRule): Target {
  if (rule.kind === "ts-string") {
    if (!ts.isStringLiteralLike(node.initializer)) {
      throw new Error(`规则 ${rule.id} 的 ts-string 目标不是字符串节点`)
    }
    return stringTarget(source, node.initializer, requireTo(rule))
  }
  return {
    current: ts.isStringLiteralLike(node.initializer) ? node.initializer.text : node.initializer.getText(source),
    replacement: propertyRemoval(source, node),
  }
}

function stringTarget(source: ts.SourceFile, node: ts.StringLiteralLike, to: string): Target {
  return {
    current: node.text,
    replacement: { start: node.getStart(source), end: node.end, text: encodeString(to, node.getText(source)) },
  }
}

function propertyRemoval(source: ts.SourceFile, node: ts.PropertyAssignment): Replacement {
  const object = node.parent
  if (!ts.isObjectLiteralExpression(object)) throw new Error("对象属性缺少对象字面量父节点")
  const index = object.properties.indexOf(node)
  const next = object.properties[index + 1]
  if (next) return { start: node.getStart(source), end: next.getStart(source), text: "" }
  const previous = object.properties[index - 1]
  if (previous) return { start: previous.end, end: node.end, text: "" }
  return { start: node.getStart(source), end: node.end, text: "" }
}

function callTarget(source: ts.SourceFile, node: ts.CallExpression): Target {
  if (!ts.isExpressionStatement(node.parent)) {
    throw new Error("ts-remove-call 只允许删除完整 ExpressionStatement")
  }
  return {
    current: node.getText(source),
    replacement: { start: node.parent.getStart(source), end: node.parent.end, text: "" },
  }
}

function belongsToVariable(node: ts.ObjectLiteralExpression, name: string) {
  return ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) && node.parent.name.text === name
}

function propertyName(node: ts.PropertyName) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function encodeString(value: string, original: string) {
  const quote = original[0]
  if (quote === '"') return JSON.stringify(value)
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r")
  if (quote === "'") return `'${escaped.replaceAll("'", "\\'")}'`
  return `\`${escaped.replaceAll("`", "\\`").replaceAll("${", "\\${")}\``
}

function requireExpected(rule: TransformRule, hits: number) {
  if (hits !== rule.expected) throw new Error(`规则 ${rule.id} 命中 ${hits}，期望 ${rule.expected}`)
}

function requireTo(rule: TransformRule) {
  if (rule.to === undefined) throw new Error(`规则 ${rule.id} 缺少 to`)
  return rule.to
}

function scriptKind(file: string) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}
