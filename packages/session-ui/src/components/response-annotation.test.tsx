import { describe, expect, test } from "bun:test"
import {
  responseAnnotationCopy,
  responseAnnotationDraftActions,
  responseAnnotationEditorKeyDown,
} from "./response-annotation-logic"

const draft = {
  id: "draft-1",
  index: 1,
  context: { before: "before", selected: "selected", after: "after" },
  comment: "",
}

describe("response annotation components", () => {
  test("renders a count trigger with an accessible label", () => {
    const copy = responseAnnotationCopy((key, params) => `${key}:${JSON.stringify(params)}`, 2, 1)

    expect(copy.count).toBe('ui.responseAnnotation.count.other:{"count":2}')
    expect(copy.openCount).toBe('ui.responseAnnotation.openCount.other:{"count":2}')
    expect(responseAnnotationCopy((key) => key, 1, 1).count).toBe("ui.responseAnnotation.count.one")
  })

  test("renders empty comments and read-only history without losing the selected text", () => {
    const copy = responseAnnotationCopy((key) => key, 1, draft.index)

    expect(draft.comment || copy.empty).toBe("ui.responseAnnotation.empty")
    expect(draft.context.selected).toBe("selected")
  })

  test("exposes edit, save, cancel, delete, open, close, and source actions to keyboards", () => {
    const calls: string[] = []
    const actions = responseAnnotationDraftActions(draft, {
      onSave: (id, comment) => calls.push(`save:${id}:${comment}`),
      onDelete: (id) => calls.push(`delete:${id}`),
      onBackToSource: (annotation) => calls.push(`source:${annotation.index}`),
    })
    const copy = responseAnnotationCopy((key, params) => `${key}:${params?.index}`, 1, draft.index)

    actions.onSave("updated")
    actions.onDelete()
    actions.onBackToSource?.()

    expect(calls).toEqual(["save:draft-1:updated", "delete:draft-1", "source:1"])
    expect([copy.open, copy.edit, copy.delete, copy.source]).toEqual([
      "ui.responseAnnotation.open:1",
      "ui.responseAnnotation.edit:1",
      "ui.responseAnnotation.delete:1",
      "ui.responseAnnotation.source:1",
    ])
  })

  test("maps Enter to save, Shift+Enter to newline, and Escape to cancel", () => {
    const calls: string[] = []
    const event = (key: string, shiftKey = false) =>
      ({
        key,
        shiftKey,
        isComposing: false,
        keyCode: 0,
        preventDefault: () => calls.push("prevent"),
        stopPropagation: () => calls.push("stop"),
      }) as unknown as KeyboardEvent

    responseAnnotationEditorKeyDown(event("Enter"), () => calls.push("save"), () => calls.push("cancel"))
    expect(calls).toEqual(["stop", "prevent", "save"])

    calls.length = 0
    responseAnnotationEditorKeyDown(event("Enter", true), () => calls.push("save"), () => calls.push("cancel"))
    expect(calls).toEqual(["stop"])

    calls.length = 0
    responseAnnotationEditorKeyDown(event("Escape"), () => calls.push("save"), () => calls.push("cancel"))
    expect(calls).toEqual(["stop", "prevent", "cancel"])
  })
})
