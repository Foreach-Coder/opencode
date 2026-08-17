import { createHash } from "node:crypto"
import ts from "typescript"
import type { Replacement, TransformRecord } from "../../../common/transform/types"

export type VersionEdit = Replacement & { label: string }

export function parse(file: string, code: string) {
  return ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

export function collect<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T) {
  const nodes: T[] = []
  visit(root)
  return nodes

  function visit(node: ts.Node) {
    if (predicate(node)) nodes.push(node)
    ts.forEachChild(node, visit)
  }
}

export function requireCount<T>(label: string, nodes: readonly T[], expected = 1) {
  if (nodes.length !== expected) throw new Error(`1.18.18 结构 ${label} 命中 ${nodes.length}，期望 ${expected}`)
  return nodes
}

export function removeNode(source: ts.SourceFile, node: ts.Node, label: string): VersionEdit {
  return { start: node.getStart(source), end: node.end, text: "", label }
}

export function replaceNode(source: ts.SourceFile, node: ts.Node, text: string, label: string): VersionEdit {
  return { start: node.getStart(source), end: node.end, text, label }
}

export function removeListItem(source: ts.SourceFile, node: ts.Node, siblings: ts.NodeArray<ts.Node>, label: string) {
  const index = siblings.indexOf(node)
  const next = siblings[index + 1]
  if (next) return { start: node.getStart(source), end: next.getStart(source), text: "", label }
  const previous = siblings[index - 1]
  if (previous) return { start: previous.end, end: node.end, text: "", label }
  return removeNode(source, node, label)
}

export function removeImportSpecifier(source: ts.SourceFile, node: ts.ImportSpecifier, label: string) {
  const bindings = node.parent
  return removeListItem(source, node, bindings.elements, label)
}

export function removeTypeMember(source: ts.SourceFile, node: ts.TypeElement, label: string) {
  const parent = node.parent
  if (!ts.isTypeLiteralNode(parent) && !ts.isInterfaceDeclaration(parent)) {
    throw new Error(`1.18.18 结构 ${label} 不是 type member`)
  }
  return removeListItem(source, node, parent.members, label)
}

export function removeObjectProperty(source: ts.SourceFile, node: ts.ObjectLiteralElementLike, label: string) {
  const parent = node.parent
  if (!ts.isObjectLiteralExpression(parent)) throw new Error(`1.18.18 结构 ${label} 不是对象属性`)
  return removeListItem(source, node, parent.properties, label)
}

export function removeArrayElement(source: ts.SourceFile, node: ts.Expression, label: string) {
  if (!ts.isArrayLiteralExpression(node.parent)) throw new Error(`1.18.18 结构 ${label} 不是数组元素`)
  return removeListItem(source, node, node.parent.elements, label)
}

export function applyVersionEdits(file: string, code: string, edits: readonly VersionEdit[], id: string, hits = edits.length) {
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  ordered.forEach((edit, index) => {
    const next = ordered[index + 1]
    if (edit.start < 0 || edit.end < edit.start || edit.end > code.length) {
      throw new Error(`1.18.18 结构 ${edit.label} 转换区间无效`)
    }
    if (next && next.end > edit.start) throw new Error(`1.18.18 结构编辑重叠：${edit.label} / ${next.label}`)
  })
  const output = ordered.reduce(
    (current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end),
    code,
  )
  const diagnostics = (parse(file, output) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics
  if (diagnostics.length) throw new Error(`1.18.18 结构 ${id} 生成了无效 TypeScript：${diagnostics[0].messageText}`)
  const record: TransformRecord = {
    id,
    file,
    kind: "semantic-block",
    hits,
    before: sha256(code),
    after: sha256(output),
  }
  return { code: output, records: [record] }
}

export function propertyName(node: ts.PropertyName | ts.BindingName | undefined) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

export function callName(node: ts.CallExpression, source: ts.SourceFile) {
  return node.expression.getText(source)
}

export function importModule(node: ts.ImportDeclaration) {
  return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
}

export function assertAbsent(code: string, labels: Readonly<Record<string, string>>) {
  Object.entries(labels).forEach(([label, token]) => {
    if (code.includes(token)) throw new Error(`1.18.18 结构 ${label} 转换后仍可达`)
  })
}

export function encodeString(value: string, node: ts.StringLiteralLike, source: ts.SourceFile) {
  const original = node.getText(source)
  if (original.startsWith('"')) return JSON.stringify(value)
  if (original.startsWith("'")) return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
  return `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``
}

export function sha256(code: string) {
  return createHash("sha256").update(code.replaceAll("\r\n", "\n")).digest("hex")
}
