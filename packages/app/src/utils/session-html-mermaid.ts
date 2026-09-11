import {
  isMermaidLanguage,
  mermaidSourceKey,
  renderMermaid,
  type MermaidFailure,
} from "@opencode-ai/session-ui/markdown-mermaid"
import { markdownFenceClosed } from "@opencode-ai/session-ui/markdown-stream"
import { marked, type Tokens } from "marked"
import type { SessionExportData } from "./session-export"

export type SessionHtmlMermaidSnapshot = {
  key: string
  source: string
  svg?: string
  title?: string
  failure?: MermaidFailure
}

export async function sessionHtmlMermaidSnapshots(data: SessionExportData): Promise<SessionHtmlMermaidSnapshot[]> {
  const sources: string[] = []
  const seen = new Map<string, Set<string>>()

  for (const message of data.messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type === "text" && !part.synthetic && !part.ignored) collect(part.text)
      if (part.type === "tool" && part.tool === "task" && typeof part.state.output === "string")
        collect(taskMarkdown(part.state.output))
    }
  }

  const snapshots: SessionHtmlMermaidSnapshot[] = []
  for (const source of sources) {
    const result = await renderMermaid(source, "light")
    snapshots.push(
      result.ok
        ? { key: result.key, source: result.source, svg: result.svg, ...(result.title ? { title: result.title } : {}) }
        : { key: result.key, source: result.source, failure: result.reason },
    )
  }
  return snapshots

  function collect(markdown: string) {
    marked.walkTokens(marked.lexer(markdown), (token) => {
      if (token.type !== "code") return
      const code = token as Tokens.Code
      if (code.codeBlockStyle === "indented") return
      if (!isMermaidLanguage(code.lang)) return
      if (markdownFenceClosed(code.raw) !== true) return
      const source = code.text.endsWith("\n") ? code.text : `${code.text}\n`
      const key = mermaidSourceKey(source)
      const exact = seen.get(key)
      if (exact?.has(source)) return
      if (exact) exact.add(source)
      else seen.set(key, new Set([source]))
      sources.push(source)
    })
  }
}

function taskMarkdown(output: string) {
  const envelope = output.match(
    /^<task id="[^"\r\n]+" state="(running|completed|error)">\r?\n(?:<summary>[^\r\n]*<\/summary>\r?\n)?<(task_result|task_error)>\r?\n([\s\S]*)\r?\n<\/\2>\r?\n<\/task>$/,
  )
  return envelope?.[3] ?? output
}
