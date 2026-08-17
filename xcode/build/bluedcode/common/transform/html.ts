import type { Replacement, RuleTransform, TransformRule } from "./types"

type Attribute = { name: string; value: string; start: number; end: number }
type Element = { tag: string; attributes: Attribute[]; text: Array<{ start: number; end: number }> }
const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

export function transformHtml(code: string, rule: TransformRule): RuleTransform {
  const text = /^tag:([A-Za-z][\w:-]*)\.text$/.exec(rule.selector)
  const attribute = /^tag:([A-Za-z][\w:-]*)\[([A-Za-z_:][\w:.-]*)=([^\]]+)\]\.attribute:([A-Za-z_:][\w:.-]*)$/.exec(
    rule.selector,
  )
  const elements = parseElements(code)
  const targets =
    rule.kind === "html-text" && text
      ? elements
          .filter((element) => element.tag === text[1].toLowerCase())
          .flatMap((element) => element.text.map((span) => ({ ...span, current: code.slice(span.start, span.end) })))
      : rule.kind === "html-attribute" && attribute
        ? elements
            .filter(
              (element) =>
                element.tag === attribute[1].toLowerCase() &&
                element.attributes.some(
                  (item) => item.name === attribute[2].toLowerCase() && item.value === attribute[3],
                ),
            )
            .flatMap((element) => {
              const target = element.attributes.find((item) => item.name === attribute[4].toLowerCase())
              return target ? [{ start: target.start, end: target.end, current: target.value }] : []
            })
        : undefined
  if (!targets) {
    throw new Error(`规则 ${rule.id} 使用不支持的 selector: ${rule.selector}`)
  }
  if (targets.length !== rule.expected) throw new Error(`规则 ${rule.id} 命中 ${targets.length}，期望 ${rule.expected}`)
  const changed = targets.find((target) => target.current !== rule.from)
  if (changed) throw new Error(`规则 ${rule.id} 原值不匹配：实际为 ${JSON.stringify(changed.current)}`)
  if (rule.to === undefined) throw new Error(`规则 ${rule.id} 缺少 to`)
  return {
    hits: targets.length,
    replacements: targets.map((target): Replacement => ({ start: target.start, end: target.end, text: rule.to! })),
  }
}

function parseElements(code: string) {
  const elements: Element[] = []
  const stack: Element[] = []
  let cursor = 0
  while (cursor < code.length) {
    const opening = code.indexOf("<", cursor)
    if (opening === -1) {
      if (stack.length && cursor < code.length) stack.at(-1)!.text.push({ start: cursor, end: code.length })
      break
    }
    if (stack.length && opening > cursor) stack.at(-1)!.text.push({ start: cursor, end: opening })
    if (code.startsWith("<!--", opening)) {
      const end = code.indexOf("-->", opening + 4)
      cursor = end === -1 ? code.length : end + 3
      continue
    }
    const closing = findTagEnd(code, opening + 1)
    if (closing === -1) break
    const inside = code.slice(opening + 1, closing)
    const trimmed = inside.trim()
    if (trimmed.startsWith("/")) {
      const tag = trimmed.slice(1).trim().toLowerCase()
      const index = stack.findLastIndex((element) => element.tag === tag)
      if (index >= 0) stack.splice(index)
      cursor = closing + 1
      continue
    }
    if (trimmed && !trimmed.startsWith("!") && !trimmed.startsWith("?")) {
      const element = parseOpeningTag(code, opening + 1, closing)
      elements.push(element)
      if (!trimmed.endsWith("/") && !voidElements.has(element.tag)) stack.push(element)
    }
    cursor = closing + 1
  }
  return elements
}

function parseOpeningTag(code: string, start: number, end: number): Element {
  let cursor = skipWhitespace(code, start, end)
  const tagStart = cursor
  while (cursor < end && !isWhitespace(code[cursor]) && code[cursor] !== "/") cursor += 1
  const tag = code.slice(tagStart, cursor).toLowerCase()
  const attributes: Attribute[] = []
  while (cursor < end) {
    cursor = skipWhitespace(code, cursor, end)
    if (cursor >= end || code[cursor] === "/") break
    const nameStart = cursor
    while (cursor < end && !isWhitespace(code[cursor]) && code[cursor] !== "=" && code[cursor] !== "/") cursor += 1
    const name = code.slice(nameStart, cursor).toLowerCase()
    cursor = skipWhitespace(code, cursor, end)
    if (code[cursor] !== "=") {
      attributes.push({ name, value: "", start: cursor, end: cursor })
      continue
    }
    cursor = skipWhitespace(code, cursor + 1, end)
    const quote = code[cursor] === '"' || code[cursor] === "'" ? code[cursor++] : undefined
    const valueStart = cursor
    if (quote) while (cursor < end && code[cursor] !== quote) cursor += 1
    else while (cursor < end && !isWhitespace(code[cursor]) && code[cursor] !== "/") cursor += 1
    attributes.push({ name, value: code.slice(valueStart, cursor), start: valueStart, end: cursor })
    if (quote) cursor += 1
  }
  return { tag, attributes, text: [] }
}

function findTagEnd(code: string, start: number) {
  let quote: string | undefined
  for (let cursor = start; cursor < code.length; cursor += 1) {
    if (quote && code[cursor] === quote) quote = undefined
    else if (!quote && (code[cursor] === '"' || code[cursor] === "'")) quote = code[cursor]
    else if (!quote && code[cursor] === ">") return cursor
  }
  return -1
}

function skipWhitespace(code: string, start: number, end: number) {
  let cursor = start
  while (cursor < end && isWhitespace(code[cursor])) cursor += 1
  return cursor
}

function isWhitespace(value: string) {
  return value === " " || value === "\n" || value === "\r" || value === "\t"
}
