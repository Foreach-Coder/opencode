import { afterAll, beforeAll, expect, test } from "bun:test"
import type { SessionExportData } from "./session-export"
import { sessionHtmlMermaidSnapshots } from "./session-html-mermaid"

const repeated = "flowchart TD\n  Start --> Done\n"
const taskDiagram = "flowchart LR\n  Task --> Result\n"
let restoreInnerHTML: (() => void) | undefined

beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")
  if (!descriptor?.get || !descriptor.set) return
  Object.defineProperty(Element.prototype, "innerHTML", {
    ...descriptor,
    get(this: Element) {
      const value = descriptor.get?.call(this) as string
      if (!this.id.startsWith("dmermaid-") || this.firstElementChild?.localName !== "svg") return value
      const svg = this.firstElementChild.cloneNode(true) as Element
      svg.querySelectorAll("style").forEach((style) => style.remove())
      return `<svg xmlns="http://www.w3.org/2000/svg">${svg.outerHTML}</svg>`
    },
  })
  restoreInnerHTML = () => Object.defineProperty(Element.prototype, "innerHTML", descriptor)
})

afterAll(() => restoreInnerHTML?.())

const data = {
  info: { id: "ses_mermaid", title: "Mermaid export" },
  messages: [
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ type: "text", text: `\`\`\`mermaid\n${repeated}\`\`\`` }],
    },
    {
      info: { id: "msg_assistant", role: "assistant", parentID: "msg_user" },
      parts: [
        {
          type: "text",
          text: [
            `\`\`\`Mermaid title=Export\n${repeated}\`\`\``,
            `\`\`\`mermaid\n${repeated}\`\`\``,
            "```typescript mermaid\nconst ordinary = true\n```",
            "```mermaid\nflowchart TD\n  Open --> Fence",
          ].join("\n\n"),
        },
        {
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "diagram.md" },
            output: `\`\`\`mermaid\n${taskDiagram}\`\`\``,
            title: "Read",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: { description: "Render task" },
            output: `<task id="ses_child" state="completed">\n<task_result>\n~~~mermaid\n${taskDiagram}~~~\n\n\`\`\`mermaid\nnot a diagram\n\`\`\`\n</task_result>\n</task>`,
            title: "Task",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    },
  ],
} as SessionExportData

test("pre-renders completed Mermaid blocks from exported Markdown fields once per exact source", async () => {
  const snapshots = await sessionHtmlMermaidSnapshots(data)

  expect(snapshots.map((snapshot) => snapshot.source)).toEqual([repeated, taskDiagram, "not a diagram\n"])
  expect(snapshots[0]).toMatchObject({
    source: repeated,
    key: expect.stringContaining(":light:"),
    svg: expect.stringContaining("<svg"),
  })
  expect(snapshots[0]).not.toHaveProperty("failure")
  expect(snapshots[1]).toMatchObject({
    source: taskDiagram,
    key: expect.stringContaining(":light:"),
    svg: expect.stringContaining("<svg"),
  })
  expect(snapshots[1]).not.toHaveProperty("failure")
  expect(snapshots[2]).toMatchObject({ source: "not a diagram\n", failure: "syntax" })
})
