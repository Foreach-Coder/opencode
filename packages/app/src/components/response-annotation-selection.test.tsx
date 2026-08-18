import { describe, expect, test } from "bun:test"
import { responseAnnotationDraftFromSelection } from "./response-annotation-selection"

const source = {
  sessionID: "ses_1",
  messageID: "msg_assistant",
  partID: "part_text",
  markdown: "Alpha **bold** and `code`\n\n```ts\nconst emoji = '😀'\n```",
}

function fixture(input?: { role?: string; type?: string; completed?: boolean }) {
  document.body.innerHTML = `
    <div id="timeline">
      <div
        data-timeline-message-id="${source.messageID}"
        data-timeline-part-id="${source.partID}"
        data-timeline-part-role="${input?.role ?? "assistant"}"
        data-timeline-part-type="${input?.type ?? "text"}"
        data-timeline-part-completed="${input?.completed ?? true}"
      >
        <div data-component="markdown"><p>Alpha <strong>bold</strong> and <code>code</code></p><pre><code><span>const emoji = '</span><span>😀</span><span>'</span></code></pre></div>
      </div>
    </div>`
  return document.querySelector<HTMLElement>("#timeline")!
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

function draft(root: HTMLElement, selection: Selection) {
  return responseAnnotationDraftFromSelection({
    root,
    selection,
    sessionID: source.sessionID,
    id: "draft_1",
    createdAt: 123,
    getPart: (messageID, partID) =>
      messageID === source.messageID && partID === source.partID ? { markdown: source.markdown } : undefined,
  })
}

describe("response annotation selection", () => {
  test("maps a same-part cross-node selection through the shared Markdown projection", () => {
    const root = fixture()
    const alpha = root.querySelector("p")!.firstChild!
    const bold = root.querySelector("strong")!.firstChild!
    const result = draft(root, select(alpha, 2, bold, 4))

    expect(result).toMatchObject({
      id: "draft_1",
      source: { sessionID: "ses_1", messageID: "msg_assistant", partID: "part_text", start: 2, end: 10 },
      context: { selected: "pha bold" },
      comment: "",
      createdAt: 123,
    })
  })

  test("maps inline-code and fenced-code text nodes", () => {
    const root = fixture()
    const inline = root.querySelector("p code")!.firstChild!
    expect(draft(root, select(inline, 0, inline, 4))?.context.selected).toBe("code")

    const code = root.querySelectorAll("pre span")[0]!.firstChild!
    const emoji = root.querySelectorAll("pre span")[1]!.firstChild!
    expect(draft(root, select(code, 6, emoji, 2))?.context.selected).toBe("emoji = '😀")
  })

  test("uses Unicode code-point offsets rather than UTF-16 offsets", () => {
    const root = fixture()
    const emoji = root.querySelectorAll("pre span")[1]!.firstChild!
    const result = draft(root, select(emoji, 0, emoji, 2))

    expect(result?.context.selected).toBe("😀")
    expect(result?.source.end! - result?.source.start!).toBe(1)
  })

  test("maps a repeated merged text node when rendered soft-break whitespace differs from the projection", () => {
    const markdown = "repeat\nrepeat"
    document.body.innerHTML = `
      <div id="timeline">
        <div data-timeline-message-id="msg_assistant" data-timeline-part-id="part_text"
          data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
          <div data-component="markdown"><p>repeat\nrepeat</p></div>
        </div>
      </div>`
    const root = document.querySelector<HTMLElement>("#timeline")!
    const text = root.querySelector("p")!.firstChild!
    const result = responseAnnotationDraftFromSelection({
      root,
      selection: select(text, 7, text, 13),
      sessionID: "ses_1",
      id: "draft_soft_break",
      createdAt: 1,
      getPart: () => ({ markdown }),
    })

    expect(result?.source).toMatchObject({ start: 7, end: 13 })
    expect(result?.context.selected).toBe("repeat")
  })

  test("rejects cross-part selections", () => {
    const root = fixture()
    root.insertAdjacentHTML(
      "beforeend",
      '<div data-timeline-message-id="msg_other" data-timeline-part-id="part_other" data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true"><span>Other</span></div>',
    )
    const first = root.querySelector("p")!.firstChild!
    const other = root.querySelector('[data-timeline-part-id="part_other"] span')!.firstChild!

    expect(draft(root, select(first, 0, other, 5))).toBeUndefined()
  })

  test.each([
    ["user part", { role: "user" }],
    ["reasoning part", { type: "reasoning" }],
    ["tool part", { type: "tool" }],
    ["streaming part", { completed: false }],
  ])("rejects a %s", (_name, attrs) => {
    const root = fixture(attrs)
    const text = root.querySelector("p")!.firstChild!
    expect(draft(root, select(text, 0, text, 5))).toBeUndefined()
  })

  test("rejects a selection longer than the client capacity limit", () => {
    const markdown = "x".repeat(4_001)
    document.body.innerHTML = `<div id="timeline"><div data-timeline-message-id="msg_assistant" data-timeline-part-id="part_text" data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true"><div data-component="markdown">${markdown}</div></div></div>`
    const root = document.querySelector<HTMLElement>("#timeline")!
    const text = root.querySelector('[data-component="markdown"]')!.firstChild!
    const result = responseAnnotationDraftFromSelection({
      root,
      selection: select(text, 0, text, markdown.length),
      sessionID: "ses_1",
      id: "draft_limit",
      createdAt: 1,
      getPart: () => ({ markdown }),
    })

    expect(result).toBeUndefined()
  })
})
