import { describe, expect, mock, test } from "bun:test"
import { ANNOTATION_METADATA_KEY, type ResponseAnnotation } from "@opencode-ai/core/session/response-annotation"
import { createResponseAnnotationSourceNavigator } from "@/components/response-annotation-selection"
import type { Part } from "@opencode-ai/sdk/v2"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: () => true,
  groupParts: () => [],
}))

const { MessageResponseAnnotation } = await import("./rows")

const annotation: ResponseAnnotation = {
  index: 1,
  source: {
    messageID: "msg_source",
    partID: "part_source",
    start: 7,
    end: 15,
    digest: "sha256:digest",
  },
  context: { before: "before ", selected: "selected", after: " after" },
  comment: "note",
}

describe("historical response annotations", () => {
  test("reads one normalized metadata carrier and rejects multiple carriers", () => {
    const carrier = {
      id: "part_carrier",
      sessionID: "ses_1",
      messageID: "msg_user",
      type: "text",
      text: "revise",
      metadata: { [ANNOTATION_METADATA_KEY]: { version: 1, annotations: [annotation] } },
    } as unknown as Part

    expect(MessageResponseAnnotation.fromParts([carrier])).toEqual([annotation])
    expect(MessageResponseAnnotation.fromParts([carrier, { ...carrier, id: "part_other" } as Part])).toEqual([])
  })

  test("reveals the source message and expires the reconstructed highlight", async () => {
    document.body.innerHTML = `
      <div id="timeline">
        <div data-timeline-message-id="msg_source" data-timeline-part-id="part_source"
          data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
          <div data-component="markdown"><p>before selected after</p></div>
        </div>
      </div>`
    const root = document.querySelector<HTMLElement>("#timeline")!
    const source = root.firstElementChild as HTMLElement & { scrollIntoView: () => void }
    let scrolled = 0
    source.scrollIntoView = () => scrolled++
    const revealed: string[] = []
    const navigator = createResponseAnnotationSourceNavigator({
      root: () => root,
      revealMessage: (messageID) => revealed.push(messageID),
      getPart: (messageID, partID) =>
        messageID === "msg_source" && partID === "part_source" ? { markdown: "before selected after" } : undefined,
      duration: 10,
    })

    expect(navigator.available(annotation.source)).toBe(true)
    expect(await navigator.go(annotation.source)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(revealed).toEqual(["msg_source"])
    expect(scrolled).toBe(1)
    expect(source.dataset.responseAnnotationHighlight).toBeUndefined()
    navigator.dispose()
  })

  test("waits boundedly for a virtualized source to mount after reveal", async () => {
    document.body.innerHTML = '<div id="timeline"></div>'
    const root = document.querySelector<HTMLElement>("#timeline")!
    const navigator = createResponseAnnotationSourceNavigator({
      root: () => root,
      revealMessage: () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.innerHTML = `
              <div data-timeline-message-id="msg_source" data-timeline-part-id="part_source">
                <div data-component="markdown"><p>before selected after</p></div>
              </div>`
            const source = root.firstElementChild as HTMLElement & { scrollIntoView: () => void }
            source.scrollIntoView = () => {}
          })
        })
      },
      getPart: () => ({ markdown: "before selected after" }),
      duration: 100,
    })

    expect(await navigator.go(annotation.source)).toBe(true)
    expect(root.firstElementChild?.hasAttribute("data-response-annotation-highlight")).toBe(true)
    navigator.dispose()
  })

  test("disables navigation when the historical source no longer exists", async () => {
    const navigator = createResponseAnnotationSourceNavigator({
      root: () => document.body,
      revealMessage: () => {
        throw new Error("must not reveal a missing source")
      },
      getPart: () => undefined,
    })

    expect(navigator.available(annotation.source)).toBe(false)
    expect(await navigator.go(annotation.source)).toBe(false)
    navigator.dispose()
  })
})
