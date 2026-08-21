import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ServerScope } from "@/utils/server-scope"
import type { Platform } from "@/context/platform"
import { createPromptSession, createPromptState, type ResponseAnnotationDraft } from "@/context/prompt-state"

const annotation = (id: string, createdAt = 1): ResponseAnnotationDraft => ({
  id,
  source: {
    sessionID: "ses_1",
    messageID: "msg_1",
    partID: "part_1",
    partDigest: "sha256:abc",
    start: 0,
    end: 4,
  },
  context: { before: "", selected: "text", after: "" },
  comment: "note",
  createdAt,
})

function memoryDraftPlatform() {
  const drafts = new Map<string, string>()
  return {
    platform: "web",
    openExternal: () => undefined,
    restart: async () => undefined,
    notify: async () => undefined,
    draftStore: {
      getItem: async (key: string) => drafts.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        drafts.set(key, value)
      },
      removeItem: async (key: string) => {
        drafts.delete(key)
      },
      putBlob: async () => ({ id: "blob", url: "blob:fixture" }),
    },
  } satisfies Platform
}

describe("response annotation prompt state", () => {
  test("manages drafts independently of file context and clears them on reset", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()
      prompt.context.addResponseAnnotation(annotation("second", 2))
      prompt.context.addResponseAnnotation(annotation("first", 1))
      prompt.context.addResponseAnnotation(annotation("first", 1))

      expect(prompt.context.items().map((item) => item.type)).toEqual(["response-annotation", "response-annotation"])
      expect(prompt.context.responseAnnotations().map((item) => item.id)).toEqual(["first", "second"])
      prompt.context.updateResponseAnnotation("second", { comment: "updated" })
      expect(prompt.context.responseAnnotations()[1]?.comment).toBe("updated")
      prompt.context.removeResponseAnnotation("first")
      expect(prompt.context.responseAnnotations().map((item) => item.id)).toEqual(["second"])
      prompt.context.replaceResponseAnnotations([annotation("third", 3), annotation("first", 1)])
      expect(prompt.context.responseAnnotations().map((item) => item.id)).toEqual(["first", "third"])
      prompt.reset()
      expect(prompt.context.responseAnnotations()).toEqual([])
      dispose()
    })
  })

  test("hydrates only the same server, workspace, and session", async () => {
    const platform = memoryDraftPlatform()
    let first!: ReturnType<typeof createPromptSession>
    let restored!: ReturnType<typeof createPromptSession>
    let otherSession!: ReturnType<typeof createPromptSession>
    let otherWorkspace!: ReturnType<typeof createPromptSession>

    createRoot((dispose) => {
      first = createPromptSession(ServerScope.local, { dir: "/repo", id: "session-a" }, undefined, platform)
      return dispose
    })
    await first.ready.promise
    first.context.addResponseAnnotation(annotation("draft-a"))
    await Promise.resolve()

    createRoot((dispose) => {
      restored = createPromptSession(ServerScope.local, { dir: "/repo", id: "session-a" }, undefined, platform)
      otherSession = createPromptSession(ServerScope.local, { dir: "/repo", id: "session-b" }, undefined, platform)
      otherWorkspace = createPromptSession(ServerScope.local, { dir: "/other", id: "session-a" }, undefined, platform)
      return dispose
    })
    await Promise.all([restored.ready.promise, otherSession.ready.promise, otherWorkspace.ready.promise])

    expect(restored.context.responseAnnotations().map((item) => item.id)).toEqual(["draft-a"])
    expect(otherSession.context.responseAnnotations()).toEqual([])
    expect(otherWorkspace.context.responseAnnotations()).toEqual([])
  })
})
