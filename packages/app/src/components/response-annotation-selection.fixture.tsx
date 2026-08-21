import { createSignal, type Setter } from "solid-js"
import { render } from "solid-js/web"
import type { ResponseAnnotationDraft } from "@/context/prompt"
import { digestProjection } from "@opencode-ai/core/session/response-annotation"
import { ResponseAnnotationSelection } from "./response-annotation-selection"

const source = {
  sessionID: "ses_1",
  messageID: "msg_assistant",
  partID: "part_text",
  markdown: "你好！有什么可以帮你的吗？",
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = document.getSelection()
  check(selection, "document selection must exist")
  selection.removeAllRanges()
  selection.addRange(range)
}

async function tick() {
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await Promise.resolve()
}

type TestHighlight = { ranges: Range[] }

function installHighlightRegistry() {
  const css = Object.getOwnPropertyDescriptor(globalThis, "CSS")
  const highlight = Object.getOwnPropertyDescriptor(globalThis, "Highlight")
  const registry = new Map<string, TestHighlight>()
  class FixtureHighlight {
    ranges: Range[]

    constructor(...ranges: Range[]) {
      this.ranges = ranges
    }
  }
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { highlights: registry },
  })
  Object.defineProperty(globalThis, "Highlight", {
    configurable: true,
    value: FixtureHighlight,
  })
  return {
    registry,
    restore: () => {
      if (css) Object.defineProperty(globalThis, "CSS", css)
      else Reflect.deleteProperty(globalThis, "CSS")
      if (highlight) Object.defineProperty(globalThis, "Highlight", highlight)
      else Reflect.deleteProperty(globalThis, "Highlight")
    },
  }
}

function installRangeGeometry() {
  const rect = {
    left: 10,
    top: 20,
    width: 30,
    height: 8,
    bottom: 28,
    right: 40,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  } as DOMRect
  const previousRangeRect = Range.prototype.getBoundingClientRect
  const previousRangeRects = Range.prototype.getClientRects
  Range.prototype.getBoundingClientRect = () => rect
  Range.prototype.getClientRects = () => Object.assign([rect], { item: (index: number) => [rect][index] ?? null })
  return () => {
    Range.prototype.getBoundingClientRect = previousRangeRect
    Range.prototype.getClientRects = previousRangeRects
  }
}

function installMutableRangeGeometry(position: { left: number; top: number }) {
  const previousRangeRect = Range.prototype.getBoundingClientRect
  const previousRangeRects = Range.prototype.getClientRects
  const rect = () =>
    ({
      left: position.left,
      top: position.top,
      width: 30,
      height: 8,
      bottom: position.top + 8,
      right: position.left + 30,
      x: position.left,
      y: position.top,
      toJSON: () => ({}),
    }) as DOMRect
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = () => {
    const value = rect()
    return Object.assign([value], { item: (index: number) => [value][index] ?? null })
  }
  return () => {
    Range.prototype.getBoundingClientRect = previousRangeRect
    Range.prototype.getClientRects = previousRangeRects
  }
}

function installCaretGeometry(text: Node) {
  const descriptor = Object.getOwnPropertyDescriptor(document, "caretPositionFromPoint")
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: (x: number) => ({ offsetNode: text, offset: x < 20 ? 0 : 5 }),
  })
  return () => {
    if (descriptor) Object.defineProperty(document, "caretPositionFromPoint", descriptor)
    else Reflect.deleteProperty(document, "caretPositionFromPoint")
  }
}

export async function selectionReleasePositionCheck() {
  const restoreGeometry = installRangeGeometry()
  document.body.innerHTML = `
    <div style="transform: translateY(41px)">
      <div id="timeline">
        <div style="display: contents"
          data-timeline-message-id="${source.messageID}"
          data-timeline-part-id="${source.partID}"
          data-timeline-part-role="assistant"
          data-timeline-part-type="text"
          data-timeline-part-completed="true">
          <div data-component="markdown"><p>你好！有什么可以帮你的吗？</p></div>
        </div>
      </div>
      <div id="composer" contenteditable="true">未发送草稿</div>
      <div id="selection-host"></div>
    </div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  const composer = document.querySelector<HTMLElement>("#composer")
  const text = root?.querySelector("p")?.firstChild
  check(
    root && host && composer && text,
    "completed assistant text, composer, and transformed component host must render",
  )
  const restoreCaret = installCaretGeometry(text)
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={() => root}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={(messageID, partID) =>
          messageID === source.messageID && partID === source.partID ? { markdown: source.markdown } : undefined
        }
        onAdd={() => undefined}
      />
    ),
    host,
  )
  try {
    composer.focus()
    const composerText = composer.firstChild
    check(composerText, "draft composer text must render")
    select(composerText, 3, composerText, 3)
    check(document.activeElement === composer, "draft composer must begin focused")
    root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 24 }))
    check(document.activeElement !== composer, "starting a timeline selection must release the focused draft composer")
    check(
      document.getSelection()?.rangeCount === 0,
      "starting a timeline selection must clear the stale composer range",
    )
    select(text, 1, text, 3)
    const nativeSelection = document.getSelection()?.toString()
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: 40, clientY: 24 }))
    check(
      document.getSelection()?.toString() === nativeSelection,
      "response annotations must observe the browser selection without rewriting its range",
    )
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }))
    await tick()
    check(
      !document.querySelector('[data-component="response-annotation-selection-action"]'),
      "selection action must remain hidden while the pointer is selecting",
    )

    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 24 }))
    await tick()
    const action = document.querySelector<HTMLElement>('[data-component="response-annotation-selection-action"]')
    check(action, "selection action must appear after pointer release")
    check(
      document.body.contains(action) && !host.contains(action),
      "selection action must escape transformed layout ancestors",
    )
    check(action.style.left === "56px", "selection action must clamp inside the left viewport edge")
    check(action.style.top === "36px", "selection action must flip below a top-edge selection")
    check(
      action.style.transform === "translate(-50%, 0)",
      "selection action must remain fully visible after flipping below the anchor",
    )
  } finally {
    dispose()
    restoreCaret()
    restoreGeometry()
    document.body.replaceChildren()
  }
}

export async function selectionActionCheck(
  input: {
    lateRoot?: boolean
    trigger?: "selectionchange" | "mouseup"
    cancel?: boolean
    presentation?: boolean
    keyboard?: boolean
  } = {},
) {
  const restoreGeometry = installRangeGeometry()
  document.body.innerHTML = `
    <div style="transform: translateY(41px)">
      <div id="timeline">
        <div style="display: contents"
          data-timeline-message-id="${source.messageID}"
          data-timeline-part-id="${source.partID}"
          data-timeline-part-role="assistant"
          data-timeline-part-type="text"
          data-timeline-part-completed="true">
          <div data-component="text-part" data-timeline-part-id="${source.partID}">
            <div data-slot="text-part-body">
              <div data-component="markdown"><p>你好！有什么可以帮你的吗？</p></div>
            </div>
          </div>
        </div>
      </div>
      <div id="selection-host"></div>
    </div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  check(root && host, "timeline root and transformed component host must render")
  const [timelineRoot, setTimelineRoot] = createSignal<HTMLElement | undefined>(input.lateRoot ? undefined : root)
  const added: ResponseAnnotationDraft[] = []
  const text = root.querySelector("p")?.firstChild
  check(text, "assistant text node must render")
  if (input.trigger === "mouseup") select(text, 0, text, 5)
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={timelineRoot}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={(messageID, partID) =>
          messageID === source.messageID && partID === source.partID ? { markdown: source.markdown } : undefined
        }
        onAdd={(draft) => added.push(draft)}
      />
    ),
    host,
  )
  try {
    if (input.lateRoot) (setTimelineRoot as Setter<HTMLElement | undefined>)(root)
    if (input.trigger !== "mouseup") select(text, 0, text, 5)
    if (input.keyboard)
      document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight", shiftKey: true }))
    else document.dispatchEvent(new Event(input.trigger ?? "selectionchange", { bubbles: true }))
    await tick()
    const action = document.querySelector<HTMLButtonElement>('[data-component="response-annotation-selection-action"]')
    check(action?.textContent === "添加注释", "selection action must render")
    if (input.keyboard) check(document.activeElement === action, "keyboard selection must focus the annotation action")
    if (input.presentation) {
      check(
        action.classList.contains("bg-surface-raised-base") && !action.classList.contains("border"),
        "selection action must use a raised background instead of a persistent border",
      )
    }
    action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }))
    action.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }))
    action.click()
    await tick()
    check(added.length === 0, "opening the comment editor must not add an unfinished draft")
    const editor = document.querySelector<HTMLElement>(
      '[data-component="response-annotation-selection-editor"][role="dialog"]',
    )
    check(editor, "selection action must open the anchored comment editor")
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")
    check(textarea, "selection editor must contain a textarea")
    check(document.activeElement === textarea, "selection editor must focus its textarea")

    if (input.presentation) {
      const card = editor.querySelector<HTMLElement>('[data-component="response-annotation-editor"]')
      check(card, "selection editor card must render")
      check(
        editor.classList.contains("w-[min(320px,calc(100vw-24px))]"),
        "selection editor must use the compact Codex width",
      )
      check(
        card.classList.contains("rounded-[20px]") &&
          card.classList.contains("bg-surface-raised-base") &&
          !card.classList.contains("border"),
        "selection editor must use the borderless rounded Codex surface",
      )
      check(textarea.placeholder === "添加注释…", "selection editor must use an annotation placeholder")
      const actions = card.querySelector<HTMLElement>('[data-slot="response-annotation-editor-actions"]')
      check(actions && !actions.classList.contains("border-t"), "selection editor actions must share the card surface")
      check(
        [...actions.querySelectorAll("button")].map((button) => button.textContent?.trim()).join(",") === "取消,保存",
        "a new annotation must expose only cancel and save actions",
      )
      check(
        !actions.querySelector('[aria-label*="voice" i], [aria-label*="语音"]'),
        "selection editor must not expose voice input",
      )
      check(
        !actions.querySelector<HTMLButtonElement>('[data-action="response-annotation-save"]')?.disabled,
        "selection editor must allow an empty comment",
      )
      const cancel = actions.querySelector<HTMLElement>('[data-action="response-annotation-cancel"]')
      check(
        cancel?.classList.contains("bg-surface-raised-strong") && !cancel.classList.contains("border"),
        "cancel must use a background level instead of a persistent border",
      )
    }

    if (input.cancel) {
      const cancel = [...editor.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "取消",
      )
      if (input.keyboard) {
        cancel?.focus()
        cancel?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      } else cancel?.click()
      await tick()
      check(added.length === 0, "cancel must not add a draft")
      check(
        !document.querySelector('[data-component="response-annotation-selection-editor"]'),
        "cancel must close the selection editor",
      )
      return
    }

    if (input.presentation) {
      editor.querySelector<HTMLButtonElement>('[data-action="response-annotation-save"]')?.click()
      await tick()
      check(added.length === 1 && added[0]?.comment === "", "save must create an annotation with an empty comment")
      return
    }

    textarea.value = "请解释这里"
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
    ;[...editor.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存")?.click()
    await tick()
    check(added.length === 1, "save must add one completed draft")
    check(added[0]?.comment === "请解释这里", "save must preserve the entered comment")
    check(
      !document.querySelector('[data-component="response-annotation-selection-editor"]'),
      "save must close the selection editor",
    )
  } finally {
    dispose()
    restoreGeometry()
    document.body.replaceChildren()
  }
}

export async function selectionEditingHighlightCheck() {
  const restoreGeometry = installRangeGeometry()
  const highlights = installHighlightRegistry()
  document.body.innerHTML = `
    <div id="timeline">
      <div data-timeline-message-id="${source.messageID}" data-timeline-part-id="${source.partID}"
        data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
        <div data-component="markdown"><p>${source.markdown}</p></div>
      </div>
    </div>
    <div id="selection-host"></div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  const text = root?.querySelector("p")?.firstChild
  check(root && host && text, "selection highlight fixture must render")
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={() => root}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={() => ({ markdown: source.markdown })}
        onAdd={() => undefined}
      />
    ),
    host,
  )
  try {
    select(text, 0, text, 5)
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }))
    await tick()
    document.querySelector<HTMLButtonElement>('[data-component="response-annotation-selection-action"]')?.click()
    await tick()
    check(
      !document.querySelector("[data-response-annotation-highlight-overlay]"),
      "response annotations must not paint fixed color-block overlays into the document body",
    )
    const activeHighlight = [...highlights.registry.entries()].find(([name]) => name.endsWith("-active"))?.[1]
    check(activeHighlight?.ranges.length === 1, "the active source range must use the browser highlight registry")
    const badge = document.querySelector<HTMLElement>('[data-component="response-annotation-source-badge"]')
    check(badge?.textContent === "1", "a new annotation editor must show its pending source badge")
    check(root.contains(badge), "the pending source badge must stay inside its timeline root")
    check(
      badge.style.backgroundColor === "var(--icon-interactive-base)" &&
        badge.style.color === "var(--text-on-interactive-base)",
      "the pending source badge must have explicit visible product-theme colors",
    )
    check(
      !badge.classList.contains("border-2") && !badge.classList.contains("border-background-base"),
      "the pending source badge must use its solid background instead of a white ring",
    )
    const editor = document.querySelector<HTMLElement>('[data-component="response-annotation-selection-editor"]')
    check(editor, "the anchored annotation editor must render")
    check(
      editor.querySelector('[data-component="response-annotation-editor"]') &&
        !editor.querySelector('[data-slot^="line-comment"]'),
      "the response annotation editor must use its dedicated UI instead of file line-comment controls",
    )
    check(
      Number.parseFloat(editor.style.left) >= Number.parseFloat(badge.style.left) + 31,
      "a right-side editor must leave the full source badge visible and clickable",
    )
  } finally {
    dispose()
    check(highlights.registry.size === 0, "disposing the session view must clear browser highlights")
    highlights.restore()
    restoreGeometry()
    document.body.replaceChildren()
  }
}

export async function replacedDirectiveSelectionMarkerCheck() {
  const restoreGeometry = installRangeGeometry()
  const highlights = installHighlightRegistry()
  const directive = ':bluedcode-annotation{index="1"}'
  const visible = " 所选内容为“有什么可以帮你的吗？”。这是一句中文问候语，意思是询问对方是否需要帮助。"
  const markdown = `${directive}${visible}`
  document.body.innerHTML = `
    <div id="timeline">
      <div data-timeline-message-id="${source.messageID}" data-timeline-part-id="${source.partID}"
        data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
        <div data-component="markdown"><p><span data-component="response-annotation-reference"
          data-response-annotation-directive='${directive}'>注释 1</span><span id="visible-response">${visible}</span></p></div>
      </div>
    </div>
    <div id="selection-host"></div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  const text = document.querySelector("#visible-response")?.firstChild
  check(root && host && text, "replaced directive selection fixture must render")
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={() => root}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={() => ({ markdown })}
        onAdd={() => undefined}
      />
    ),
    host,
  )
  try {
    const selected = "中文问候语"
    const start = text.data.indexOf(selected)
    select(text, start, text, start + selected.length)
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }))
    await tick()
    document.querySelector<HTMLButtonElement>('[data-component="response-annotation-selection-action"]')?.click()
    await tick()
    check(
      [...highlights.registry.entries()].some(([name, value]) => name.endsWith("-active") && value.ranges.length === 1),
      "a source range after a replaced annotation directive must keep its active browser highlight",
    )
    check(
      document.querySelector('[data-component="response-annotation-source-badge"][data-active]'),
      "a source range after a replaced annotation directive must keep its active badge",
    )
  } finally {
    dispose()
    highlights.restore()
    restoreGeometry()
    document.body.replaceChildren()
  }
}

export async function pendingAnnotationBadgeCheck() {
  const restoreGeometry = installRangeGeometry()
  const highlights = installHighlightRegistry()
  document.body.innerHTML = `
    <div id="timeline">
      <div data-timeline-message-id="${source.messageID}" data-timeline-part-id="${source.partID}"
        data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
        <div data-component="markdown"><p>${source.markdown}</p></div>
      </div>
    </div>
    <div id="selection-host"></div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  check(root && host, "pending annotation fixture must render")
  const first: ResponseAnnotationDraft = {
    id: "draft_1",
    source: {
      sessionID: source.sessionID,
      messageID: source.messageID,
      partID: source.partID,
      partDigest: digestProjection(source.markdown),
      start: 0,
      end: 2,
    },
    context: { before: "", selected: "你好", after: "！有什么可以帮你的吗？" },
    comment: "第一条评论",
    createdAt: 1,
  }
  const second: ResponseAnnotationDraft = {
    id: "draft_2",
    source: {
      sessionID: source.sessionID,
      messageID: source.messageID,
      partID: source.partID,
      partDigest: digestProjection(source.markdown),
      start: 7,
      end: 9,
    },
    context: { before: "你好！有什么可以", selected: "帮你", after: "的吗？" },
    comment: "第二条评论",
    createdAt: 2,
  }
  const [drafts, setDrafts] = createSignal([first, second])
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={() => root}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={() => ({ markdown: source.markdown })}
        onAdd={(draft) => setDrafts((items) => [...items, draft])}
        annotations={drafts}
        onUpdate={(id: string, comment: string) =>
          setDrafts((items) => items.map((item) => (item.id === id ? { ...item, comment } : item)))
        }
        onRemove={(id: string) => setDrafts((items) => items.filter((item) => item.id !== id))}
      />
    ),
    host,
  )
  try {
    await tick()
    const badges = () => [
      ...document.querySelectorAll<HTMLButtonElement>('[data-component="response-annotation-source-badge"]'),
    ]
    check(badges().length === 2, "each pending annotation must render one source badge")
    check(
      badges()
        .map((badge) => badge.textContent)
        .join(",") === "1,2",
      "source badges must follow the composer annotation order",
    )
    check(
      [...highlights.registry.entries()].some(
        ([name, value]) => !name.endsWith("-active") && value.ranges.length === 2,
      ),
      "pending annotations must keep their source ranges in the browser highlight registry",
    )
    check(
      badges().every((badge) => root.contains(badge)),
      "source badges must stay inside the timeline root",
    )

    const openedBadge = badges()[0]!
    openedBadge.click()
    await tick()
    check(openedBadge.isConnected, "opening a saved annotation must not replace the clicked badge node")
    const editor = document.querySelector<HTMLElement>('[data-component="response-annotation-selection-editor"]')
    check(editor, "clicking a source badge must open the matching editor")
    check(
      [...highlights.registry.entries()].some(([name, value]) => name.endsWith("-active") && value.ranges.length === 1),
      "badge editing must move the matching source range into the active browser highlight",
    )
    const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")
    check(textarea?.value === "第一条评论", "badge editing must load the matching saved comment")
    const deleteButton = editor.querySelector<HTMLButtonElement>(
      '[data-component="response-annotation-selection-delete"]',
    )
    check(
      deleteButton?.closest('[data-slot="response-annotation-editor-leading-actions"]'),
      "the saved annotation delete action must occupy the dedicated editor toolbar's leading slot",
    )
    check(
      !deleteButton?.className.includes("absolute"),
      "the delete action must not overlay the editor with positioning",
    )
    textarea.value = "第一条评论已修改"
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }))
    ;[...editor.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存")?.click()
    await tick()
    check(drafts()[0]?.comment === "第一条评论已修改", "saving badge editing must update the existing draft")
    check(badges().length === 2, "editing an existing annotation must not create another badge")
    check(!badges()[0]?.hasAttribute("data-active"), "a saved annotation badge must not expose a false active state")

    badges()[0]!.click()
    await tick()
    document.querySelector<HTMLButtonElement>('[data-component="response-annotation-selection-delete"]')?.click()
    await tick()
    check(drafts().length === 1 && drafts()[0]?.id === "draft_2", "delete must remove the matching pending draft")
    check(badges().length === 1 && badges()[0]?.textContent === "1", "remaining source badges must be renumbered")
    check(badges()[0]?.dataset.annotationId === "draft_2", "renumbering must keep the badge attached to its source")
  } finally {
    dispose()
    check(highlights.registry.size === 0, "disposing pending annotations must clear browser highlights")
    highlights.restore()
    restoreGeometry()
    document.body.replaceChildren()
  }
}

export async function editorRepositionAndInvalidSourceCheck() {
  const position = { left: 120, top: 160 }
  const restoreGeometry = installMutableRangeGeometry(position)
  document.body.innerHTML = `
    <div id="timeline">
      <div id="source-message" data-timeline-message-id="${source.messageID}" data-timeline-part-id="${source.partID}"
        data-timeline-part-role="assistant" data-timeline-part-type="text" data-timeline-part-completed="true">
        <div data-component="markdown"><p>${source.markdown}</p></div>
      </div>
    </div>
    <div id="selection-host"></div>`
  const root = document.querySelector<HTMLElement>("#timeline")
  const host = document.querySelector<HTMLElement>("#selection-host")
  check(root && host, "reposition fixture must render")
  const draft: ResponseAnnotationDraft = {
    id: "draft_reposition",
    source: {
      sessionID: source.sessionID,
      messageID: source.messageID,
      partID: source.partID,
      partDigest: digestProjection(source.markdown),
      start: 0,
      end: 2,
    },
    context: { before: "", selected: "你好", after: "！有什么可以帮你的吗？" },
    comment: "",
    createdAt: 1,
  }
  const dispose = render(
    () => (
      <ResponseAnnotationSelection
        root={() => root}
        sessionID={source.sessionID}
        label="添加注释"
        cancelLabel="取消"
        saveLabel="保存"
        getPart={() => ({ markdown: source.markdown })}
        onAdd={() => undefined}
        annotations={() => [draft]}
        onUpdate={() => undefined}
      />
    ),
    host,
  )
  try {
    await tick()
    document.querySelector<HTMLButtonElement>('[data-component="response-annotation-source-badge"]')?.click()
    await tick()
    const editor = document.querySelector<HTMLElement>('[data-component="response-annotation-selection-editor"]')
    check(editor, "saved annotation editor must open")
    const before = `${editor.style.left}:${editor.style.top}`
    position.left = 260
    position.top = 300
    root.dispatchEvent(new Event("scroll"))
    await tick()
    check(`${editor.style.left}:${editor.style.top}` !== before, "scroll must reposition the open editor")
    document.querySelector("#source-message")?.remove()
    root.dispatchEvent(new Event("scroll"))
    await tick()
    await tick()
    check(
      !document.querySelector('[data-component="response-annotation-selection-editor"]'),
      "virtual source removal must close the stale editor",
    )
  } finally {
    dispose()
    restoreGeometry()
    document.body.replaceChildren()
  }
}
