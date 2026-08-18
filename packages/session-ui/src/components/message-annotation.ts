import {
  ANNOTATION_METADATA_KEY,
  parseAnnotationDirectives,
  type ResponseAnnotation,
} from "@opencode-ai/core/session/response-annotation"

type MessageLike = {
  id?: string
  sessionID?: string
  role?: string
  parentID?: string
}

type PartLike = {
  type?: string
  metadata?: Record<string, unknown>
}

export function annotationDirectiveToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function annotationDirectiveMarkdown(
  markdown: string,
  annotations: ResponseAnnotation[],
  label: (index: number) => string,
  streaming: boolean,
  token = "directive",
) {
  if (annotations.length === 0) return { markdown, references: [] }
  const parsed = parseAnnotationDirectives(markdown, new Set(annotations.map((annotation) => annotation.index)))
  const visible = streaming && parsed.pending && markdown.endsWith(parsed.pending)
    ? Array.from(markdown).slice(0, -Array.from(parsed.pending).length).join("")
    : markdown
  const chars = Array.from(visible)
  const references = parsed.references.filter((reference) => reference.end <= chars.length)
  const result: string[] = []
  let cursor = 0

  references.forEach((reference) => {
    result.push(chars.slice(cursor, reference.start).join(""))
    result.push(`[${label(reference.index)}](#bluedcode-response-annotation-${token}-${reference.index})`)
    cursor = reference.end
  })
  result.push(chars.slice(cursor).join(""))

  return { markdown: result.join(""), references }
}

export function responseAnnotationsForTextPart(
  partID: string,
  parts: Array<{ id?: string; type?: string; text?: string }>,
  annotations: ResponseAnnotation[],
) {
  const target = parts.findIndex((part) => part.id === partID)
  if (target < 0) return []
  const available = new Set(annotations.map((annotation) => annotation.index))
  parts.slice(0, target).forEach((part) => {
    if (part.type !== "text") return
    parseAnnotationDirectives(part.text ?? "", available).references.forEach((reference) => available.delete(reference.index))
  })
  return annotations.filter((annotation) => available.has(annotation.index))
}

export function responseAnnotationForPlaceholder(
  href: string,
  annotations: ResponseAnnotation[],
  token: string,
) {
  return annotations.find(
    (annotation) => href === `#bluedcode-response-annotation-${token}-${annotation.index}`,
  )
}

export function responseAnnotationsForAssistant(
  assistant: MessageLike,
  messages: MessageLike[],
  parts: Record<string, PartLike[] | undefined>,
) {
  if (assistant.role !== "assistant" || !assistant.parentID) return []
  const parent = messages.find(
    (message) =>
      message.id === assistant.parentID && message.role === "user" && message.sessionID === assistant.sessionID,
  )
  if (!parent?.id) return []
  const carriers = (parts[parent.id] ?? []).flatMap((part) => {
    if (part.type !== "text") return []
    const value = part.metadata?.[ANNOTATION_METADATA_KEY]
    if (!annotationMetadata(value)) return []
    return [value.annotations]
  })
  if (carriers.length !== 1) return []
  return carriers[0]!
}

function annotationMetadata(value: unknown): value is { version: 1; annotations: ResponseAnnotation[] } {
  if (!value || typeof value !== "object") return false
  const metadata = value as Record<string, unknown>
  if (metadata.version !== 1 || !Array.isArray(metadata.annotations)) return false
  return metadata.annotations.every(responseAnnotation)
}

function responseAnnotation(value: unknown): value is ResponseAnnotation {
  if (!value || typeof value !== "object") return false
  const annotation = value as Record<string, unknown>
  if (!Number.isInteger(annotation.index) || typeof annotation.comment !== "string") return false
  if (!annotation.source || typeof annotation.source !== "object") return false
  if (!annotation.context || typeof annotation.context !== "object") return false
  const source = annotation.source as Record<string, unknown>
  const context = annotation.context as Record<string, unknown>
  return (
    typeof source.messageID === "string" &&
    typeof source.partID === "string" &&
    Number.isInteger(source.start) &&
    Number.isInteger(source.end) &&
    typeof source.digest === "string" &&
    typeof context.before === "string" &&
    typeof context.selected === "string" &&
    typeof context.after === "string"
  )
}
