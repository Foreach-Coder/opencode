export const ANNOTATION_METADATA_KEY = "bluedcodeResponseAnnotations"

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

type ProjectionBuilder = {
  text: string
  segments: AnnotationSegment[]
  append: (text: string, sourceStart: number, sourceEnd: number) => void
}

/**
 * Produces the readable subset of the Markdown used by response annotations.
 * This deliberately small token walk covers the CommonMark structures emitted
 * by the conversation renderer: headings, paragraphs, code, lists, links,
 * emphasis, and GitHub-style tables.
 */
export function projectAnnotationText(markdown: string): AnnotationProjection {
  const source = markdown.replace(/\r\n?/g, "\n")
  const lines = source.split("\n")
  const offsets = lines.reduce<number[]>((result, line, index) => {
    result.push(index === 0 ? 0 : result[index - 1]! + Array.from(lines[index - 1]!).length + 1)
    return result
  }, [])
  const builder = projectionBuilder()
  const blocks: Array<{ text: string; sourceStart: number; sourceEnd: number }> = []

  for (let index = 0; index < lines.length; ) {
    const line = lines[index]!
    if (!line.trim()) {
      index++
      continue
    }

    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line)) {
      const start = offsets[index]!
      const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)![1]!
      const content: string[] = []
      index++
      while (index < lines.length && !new RegExp(`^[ \\t]{0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[index]!)) {
        content.push(lines[index]!)
        index++
      }
      const end = offsets[Math.min(index, lines.length - 1)]! + Array.from(lines[Math.min(index, lines.length - 1)]!).length
      if (index < lines.length) index++
      blocks.push({ text: content.join("\n"), sourceStart: start, sourceEnd: end })
      continue
    }

    if (tableDelimiter(lines[index + 1])) {
      const start = offsets[index]!
      const rows = [tableCells(line)]
      index += 2
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) {
        rows.push(tableCells(lines[index]!))
        index++
      }
      const endLine = Math.max(index - 1, 0)
      blocks.push({
        text: rows.map((row) => row.join("\t")).join("\n"),
        sourceStart: start,
        sourceEnd: offsets[endLine]! + Array.from(lines[endLine]!).length,
      })
      continue
    }

    const list = line.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(.*)$/)
    if (list) {
      const start = offsets[index]! + Array.from(line).length - Array.from(list[1]!).length
      const items: string[] = []
      let end = start
      while (index < lines.length) {
        const item = lines[index]!.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(.*)$/)
        if (!item) break
        items.push(inlineText(item[1]!))
        end = offsets[index]! + Array.from(lines[index]!).length
        index++
      }
      blocks.push({ text: items.join("\n"), sourceStart: start, sourceEnd: end })
      continue
    }

    const start = offsets[index]!
    const paragraph: string[] = []
    let end = start
    while (index < lines.length && lines[index]!.trim()) {
      const current = lines[index]!
      if (paragraph.length && (/^[ \t]{0,3}(`{3,}|~{3,})/.test(current) || tableDelimiter(lines[index + 1]))) break
      paragraph.push(inlineText(current.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, "").replace(/^[ \t]{0,3}>[ \t]?/, "")))
      end = offsets[index]! + Array.from(current).length
      index++
    }
    blocks.push({ text: paragraph.join(" "), sourceStart: start, sourceEnd: end })
  }

  blocks.forEach((block, index) => {
    if (index) builder.append("\n\n", block.sourceStart, block.sourceStart)
    builder.append(block.text, block.sourceStart, block.sourceEnd)
  })
  return { text: builder.text, segments: builder.segments }
}

export function digestProjection(markdown: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(projectAnnotationText(markdown).text)
  return `sha256:${hash.digest("hex")}`
}

export function sliceAnnotationContext(projection: AnnotationProjection, start: number, end: number): AnnotationContext {
  const text = Array.from(projection.text)
  return {
    before: text.slice(Math.max(0, start - 160), start).join(""),
    selected: text.slice(start, end).join(""),
    after: text.slice(end, end + 160).join(""),
  }
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
  return `<response-annotations version="1">\n${JSON.stringify(annotations, undefined, 2)}\n</response-annotations>\n\n<user-request>\n${escapeText(input.userRequest)}\n</user-request>`
}

export function parseAnnotationDirectives(markdown: string, availableIndexes: ReadonlySet<number>): DirectiveParseResult {
  const references: DirectiveReference[] = []
  const seen = new Set<number>()
  let fence: { marker: string } | undefined
  let inlineFence = ""
  let offset = 0
  let pending: string | undefined

  for (const line of markdown.split(/(?<=\n)/)) {
    const body = line.endsWith("\n") ? line.slice(0, -1) : line
    const marker = fenceMarker(body)
    if (!fence && marker) {
      fence = { marker }
    } else if (fence && closesFence(body, fence.marker)) {
      fence = undefined
    } else if (!fence) {
      const parsed = parseDirectiveLine(body, offset, availableIndexes, seen, references, inlineFence)
      inlineFence = parsed.inlineFence
      pending = parsed.pending ?? pending
    }
    offset += Array.from(line).length
  }

  return { text: markdown, references, pending }
}

function fenceMarker(line: string) {
  return line.match(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/)?.[1]
}

function closesFence(line: string, marker: string) {
  return new RegExp(`^[ \\t]{0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(line.trimEnd())
}

function parseDirectiveLine(
  line: string,
  offset: number,
  availableIndexes: ReadonlySet<number>,
  seen: Set<number>,
  references: DirectiveReference[],
  initialInlineFence: string,
) {
  const chars = Array.from(line)
  let inlineFence = initialInlineFence
  for (let index = 0; index < chars.length; ) {
    if (chars[index] === "`") {
      let size = 1
      while (chars[index + size] === "`") size++
      const marker = "`".repeat(size)
      inlineFence = inlineFence === marker ? "" : inlineFence || marker
      index += size
      continue
    }
    const candidate = chars.slice(index).join("")
    const match = !inlineFence ? candidate.match(/^:bluedcode-annotation\{index="(\d+)"\}/) : undefined
    if (match) {
      const indexValue = Number(match[1])
      const length = Array.from(match[0]).length
      if (availableIndexes.has(indexValue) && !seen.has(indexValue)) {
        references.push({ index: indexValue, start: offset + index, end: offset + index + length })
        seen.add(indexValue)
      }
      index += length
      continue
    }
    if (!inlineFence && directivePrefix(candidate)) return { inlineFence, pending: candidate }
    index++
  }
  return { inlineFence, pending: undefined }
}

function directivePrefix(value: string) {
  return /^:bluedcode-annotation(?:\{(?:index(?:=(?:"?\d*)?)?)?)?$/.test(value)
}

function projectionBuilder(): ProjectionBuilder {
  const builder: ProjectionBuilder = {
    text: "",
    segments: [],
    append(text, sourceStart, sourceEnd) {
      if (!text) return
      const projectionStart = Array.from(builder.text).length
      builder.text += text
      builder.segments.push({ projectionStart, projectionEnd: projectionStart + Array.from(text).length, sourceStart, sourceEnd })
    },
  }
  return builder
}

function tableDelimiter(line: string | undefined) {
  return !!line && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => inlineText(cell.trim()))
}

function inlineText(line: string) {
  let result = ""
  const emphasis = new Set<string>()
  for (let index = 0; index < line.length; ) {
    if (line[index] === "\\" && index + 1 < line.length) {
      result += line[index + 1]
      index += 2
      continue
    }
    if (line[index] === "`") {
      const marker = line.slice(index).match(/^`+/)![0]!
      const close = line.indexOf(marker, index + marker.length)
      if (close >= 0) {
        result += line.slice(index + marker.length, close)
        index = close + marker.length
        continue
      }
    }
    const link = line.slice(index).match(/^!?\[([^\]]*)\]\([^)]*\)/)
    if (link) {
      result += inlineText(link[1]!)
      index += link[0].length
      continue
    }
    const marker = line.slice(index).match(/^(\*\*|__|~~|\*|_)/)?.[0]
    if (marker) {
      if (emphasis.has(marker)) {
        emphasis.delete(marker)
        index += marker.length
        continue
      }
      if (line.indexOf(marker, index + marker.length) >= 0) {
        emphasis.add(marker)
        index += marker.length
        continue
      }
    }
    result += line[index]
    index++
  }
  return result
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
