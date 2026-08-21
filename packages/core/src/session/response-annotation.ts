export const ANNOTATION_METADATA_KEY = "bluedcodeResponseAnnotations"

export const RESPONSE_ANNOTATION_OUTPUT_CONTRACT = `For each annotation item with index N, output :bluedcode-annotation{index="N"} immediately before the sentence or paragraph that answers its comment about the selected text. Every input index must appear exactly once. Keep the marker as plain text outside code fences, inline code, links, and quotations.`

export type AnnotationSegment = {
  projectionStart: number
  projectionEnd: number
  sourceStart: number
  sourceEnd: number
}

export type AnnotationProjection = {
  text: string
  segments: AnnotationSegment[]
}

export type AnnotationContext = {
  before: string
  selected: string
  after: string
}

export type ResponseAnnotation = {
  index: number
  source: {
    messageID: string
    partID: string
    start: number
    end: number
    digest: string
  }
  context: AnnotationContext
  comment: string
}

export type DirectiveReference = {
  index: number
  start: number
  end: number
}

export type DirectiveParseResult = {
  text: string
  references: DirectiveReference[]
  pending: string | undefined
}

export function projectAnnotationText(markdown: string): AnnotationProjection {
  const source = markdown.replace(/\r\n?/g, "\n")
  const text = projectBlocks(marked.lexer(source))
  return {
    text,
    segments: text
      ? [
          {
            projectionStart: 0,
            projectionEnd: Array.from(text).length,
            sourceStart: 0,
            sourceEnd: Array.from(source).length,
          },
        ]
      : [],
  }
}

function projectBlocks(tokens: Token[]): string {
  return tokens
    .flatMap((token) => {
      if (token.type === "space" || token.type === "hr" || token.type === "def") return []
      if (token.type === "code") return [(token as Tokens.Code).text]
      if (token.type === "list") {
        return [
          (token as Tokens.List).items.map((item) => projectBlocks(item.tokens).replace(/\n{2,}/g, "\n")).join("\n"),
        ]
      }
      if (token.type === "table") {
        const table = token as Tokens.Table
        return [
          [table.header, ...table.rows].map((row) => row.map((cell) => inlineVisible(cell.text)).join("\t")).join("\n"),
        ]
      }
      if (token.type === "blockquote") return [projectBlocks((token as Tokens.Blockquote).tokens)]
      if (token.type === "html") return [DomUtils.textContent(parseDocument((token as Tokens.HTML).text))]
      if ("text" in token && typeof token.text === "string") return [inlineVisible(token.text)]
      if ("tokens" in token && Array.isArray(token.tokens)) return [projectBlocks(token.tokens)]
      return []
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n")
}

function inlineVisible(value: string) {
  const html = marked.parseInline(value, { async: false })
  if (typeof html !== "string") throw new Error("Markdown inline projection must be synchronous")
  return DomUtils.textContent(parseDocument(html)).replace(/[ \t]*\n[ \t]*/g, " ")
}

export function digestProjection(markdown: string) {
  return `sha256:${sha256Hex(projectAnnotationText(markdown).text)}`
}

export function sliceAnnotationContext(
  projection: AnnotationProjection,
  start: number,
  end: number,
): AnnotationContext {
  const text = Array.from(projection.text)
  return {
    before: text.slice(Math.max(0, start - 160), start).join(""),
    selected: text.slice(start, end).join(""),
    after: text.slice(end, end + 160).join(""),
  }
}

export function annotationSourceMatches(
  annotation: Pick<ResponseAnnotation, "source" | "context"> & {
    source: ResponseAnnotation["source"] & { digest?: string }
  },
  markdown: string,
) {
  if (annotation.source.digest && digestProjection(markdown) !== annotation.source.digest) return false
  const projection = projectAnnotationText(markdown)
  const size = Array.from(projection.text).length
  if (annotation.source.start < 0 || annotation.source.end <= annotation.source.start || annotation.source.end > size)
    return false
  return (
    sliceAnnotationContext(projection, annotation.source.start, annotation.source.end).selected ===
    annotation.context.selected
  )
}

export function serializeResponseAnnotations(input: { annotations: ResponseAnnotation[]; userRequest: string }) {
  if (input.annotations.length === 0) return input.userRequest
  const annotations = input.annotations.map((annotation) => ({
    index: annotation.index,
    source: {
      messageID: annotation.source.messageID,
      partID: annotation.source.partID,
      start: annotation.source.start,
      end: annotation.source.end,
      digest: annotation.source.digest,
    },
    context: {
      before: annotation.context.before,
      selected: annotation.context.selected,
      after: annotation.context.after,
    },
    comment: annotation.comment,
  }))
  const payload = JSON.stringify(annotations, undefined, 2).replace(/[<>&]/g, (value) => {
    if (value === "<") return "\\u003c"
    if (value === ">") return "\\u003e"
    return "\\u0026"
  })
  return `<response-annotation-output-contract>\n${RESPONSE_ANNOTATION_OUTPUT_CONTRACT}\n</response-annotation-output-contract>\n\n<response-annotations version="1">\n${payload}\n</response-annotations>\n\n<user-request>\n${escapeText(input.userRequest)}\n</user-request>`
}

export function parseAnnotationDirectives(
  markdown: string,
  availableIndexes: ReadonlySet<number>,
): DirectiveParseResult {
  const references: DirectiveReference[] = []
  const seen = new Set<number>()
  const protectedRanges = markdownProtectedRanges(markdown)
  const expression = /:bluedcode-annotation\{index="(\d+)"\}/g
  let cursor = 0
  let projectionOffset = 0
  for (const match of markdown.matchAll(expression)) {
    const start = match.index
    const end = start + match[0].length
    const startOffset = projectionOffset + Array.from(markdown.slice(cursor, start)).length
    projectionOffset = startOffset + Array.from(match[0]).length
    cursor = end
    if (protectedRanges.some((range) => start >= range.start && start < range.end)) continue
    const index = Number(match[1])
    if (!availableIndexes.has(index) || seen.has(index)) continue
    references.push({ index, start: startOffset, end: projectionOffset })
    seen.add(index)
  }
  const candidate = markdown.slice(Math.max(0, markdown.lastIndexOf(":bluedcode-annotation")))
  const candidateStart = markdown.length - candidate.length
  const pending =
    directivePrefix(candidate) &&
    !protectedRanges.some((range) => candidateStart >= range.start && candidateStart < range.end)
      ? candidate
      : undefined
  return { text: markdown, references, pending }
}

function directivePrefix(value: string) {
  return /^:bluedcode-annotation(?:\{(?:index(?:=(?:"?\d*)?)?)?)?$/.test(value)
}

type ProtectedRange = { start: number; end: number }

function markdownProtectedRanges(markdown: string) {
  const result: ProtectedRange[] = []
  collectProtected(marked.lexer(markdown), markdown, 0, result)
  return result
}

function collectProtected(tokens: Token[], source: string, base: number, result: ProtectedRange[]) {
  let cursor = 0
  tokens.forEach((token) => {
    const start = source.indexOf(token.raw, cursor)
    if (start < 0) return
    cursor = start + token.raw.length
    const absolute = base + start
    if (["code", "codespan", "link", "image", "blockquote", "html", "def"].includes(token.type)) {
      result.push({ start: absolute, end: absolute + token.raw.length })
      return
    }
    nestedTokenArrays(token).forEach((children) => collectProtected(children, token.raw, absolute, result))
  })
}

function nestedTokenArrays(token: Token): Token[][] {
  if (token.type === "list") return (token as Tokens.List).items.map((item) => item.tokens)
  if (token.type === "table") {
    const table = token as Tokens.Table
    return [...table.header, ...table.rows.flat()].map((cell) => cell.tokens)
  }
  if ("tokens" in token && Array.isArray(token.tokens)) return [token.tokens]
  return []
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const SHA256_ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
])

function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000), false)
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0, false)

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15]!
      const right = words[index - 2]!
      const small0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)
      const small1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16]! + small0 + words[index - 7]! + small1) >>> 0
    }

    let a = state[0]!
    let b = state[1]!
    let c = state[2]!
    let d = state[3]!
    let e = state[4]!
    let f = state[5]!
    let g = state[6]!
    let h = state[7]!
    for (let index = 0; index < 64; index++) {
      const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const first = (h + big1 + choose + SHA256_ROUND[index]! + words[index]!) >>> 0
      const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const second = (big0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + first) >>> 0
      d = c
      c = b
      b = a
      a = (first + second) >>> 0
    }
    state[0] = (state[0]! + a) >>> 0
    state[1] = (state[1]! + b) >>> 0
    state[2] = (state[2]! + c) >>> 0
    state[3] = (state[3]! + d) >>> 0
    state[4] = (state[4]! + e) >>> 0
    state[5] = (state[5]! + f) >>> 0
    state[6] = (state[6]! + g) >>> 0
    state[7] = (state[7]! + h) >>> 0
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("")
}

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits))
}
import { DomUtils, parseDocument } from "htmlparser2"
import { marked, type Token, type Tokens } from "marked"
