import {
  ANNOTATION_METADATA_KEY,
  parseAnnotationDirectives,
  type ResponseAnnotation,
} from "@opencode-ai/core/session/response-annotation"
import type { SessionExportData } from "./session-export"

// Precompute presentation references with the same Markdown parser as the app.
// The offline runtime needs only these offsets, not the app's dependency graph.
export function sessionHtmlAnnotations(data: SessionExportData) {
  const users = new Map(
    data.messages.flatMap((message, index) =>
      message.info.role === "user"
        ? [[message.info.id, { message, index, annotations: annotations(message) }] as const]
        : [],
    ),
  )
  return data.messages.map((message, index) => {
    if (message.info.role === "user")
      return {
        annotations: (users.get(message.info.id)?.annotations ?? []).map((annotation) => ({
          ...annotation,
          id: `session-annotation-${index}-${annotation.index}`,
        })),
        references: [],
      }
    const parent = users.get(message.info.parentID)
    const available = new Set(
      parent?.message.info.sessionID === message.info.sessionID
        ? parent?.annotations.map((annotation) => annotation.index)
        : [],
    )
    return {
      annotations: [],
      references: message.parts.map((part) => {
        if (part.type !== "text" || part.synthetic || part.ignored || !available.size) return []
        return parseAnnotationDirectives(part.text, available).references.map((reference) => {
          available.delete(reference.index)
          return { ...reference, href: `#session-annotation-${parent!.index}-${reference.index}` }
        })
      }),
    }
  })
}

function annotations(message: SessionExportData["messages"][number]) {
  const carriers = message.parts.flatMap((part) => {
    if (part.type !== "text") return []
    const value = part.metadata?.[ANNOTATION_METADATA_KEY]
    if (!value || typeof value !== "object") return []
    const metadata = value as { version?: unknown; annotations?: unknown }
    if (metadata.version !== 1 || !Array.isArray(metadata.annotations) || !metadata.annotations.every(annotation))
      return []
    return [metadata.annotations]
  })
  return carriers.length === 1 ? carriers[0]! : []
}

function annotation(value: unknown): value is ResponseAnnotation {
  if (!value || typeof value !== "object") return false
  const item = value as ResponseAnnotation
  return (
    Number.isInteger(item.index) &&
    typeof item.comment === "string" &&
    !!item.source &&
    typeof item.source.messageID === "string" &&
    typeof item.source.partID === "string" &&
    Number.isInteger(item.source.start) &&
    Number.isInteger(item.source.end) &&
    typeof item.source.digest === "string" &&
    !!item.context &&
    typeof item.context.before === "string" &&
    typeof item.context.selected === "string" &&
    typeof item.context.after === "string"
  )
}
