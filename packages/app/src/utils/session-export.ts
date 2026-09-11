import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import type { useLanguage } from "../context/language"

// Matches the exact `{ info, messages: [{ info, parts }] }` structure produced by `opencode export` CLI
export type SessionExportData = {
  info: Session
  messages: {
    info: Message
    parts: Part[]
  }[]
}

export type SessionExportClient = {
  session: {
    get: (input: { sessionID: string }) => Promise<{ data?: Session | null }>
    messages: (input: { sessionID: string }) => Promise<{ data?: SessionExportData["messages"] | null }>
  }
}

export async function fetchSessionExport(input: {
  sessionID: string
  client: SessionExportClient
}): Promise<SessionExportData> {
  const [sessionRes, messagesRes] = await Promise.all([
    input.client.session.get({ sessionID: input.sessionID }),
    input.client.session.messages({ sessionID: input.sessionID }),
  ])

  if (!sessionRes?.data) {
    throw new Error(`Session not found: ${input.sessionID}`)
  }
  if (!messagesRes?.data) {
    throw new Error(`Failed to load messages for session: ${input.sessionID}`)
  }

  return {
    info: sessionRes.data,
    messages: messagesRes.data,
  }
}

export function sessionExportFilename(
  session: { id: string; title?: string; slug?: string },
  format: "json" | "html" = "json",
) {
  const name = session.title || session.slug || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.${format}`
}

export function downloadSessionExport(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  downloadSessionBlob(filename, blob)
}

export async function saveSessionExport(
  data: SessionExportData,
  format: "json" | "html",
  language: ReturnType<typeof useLanguage>,
) {
  const filename = sessionExportFilename(data.info, format)
  if (format === "json") {
    downloadSessionExport(filename, data)
    return filename
  }
  const { downloadSessionHtml } = await import("./session-html-download")
  await downloadSessionHtml(filename, data, language)
  return filename
}

export function downloadSessionBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Allow the browser to consume the download before releasing its backing data.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
