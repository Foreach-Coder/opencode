import { render } from "solid-js/web"
import { AnnotationReferenceMounts } from "./annotation-reference-mounts"
import {
  ResponseAnnotationDraftList,
  ResponseAnnotationHistoryList,
  ResponseAnnotationReference,
} from "./response-annotation"

const annotation = {
  id: "draft-1",
  index: 1,
  source: { messageID: "message", partID: "part", start: 0, end: 8, digest: "sha256:x" },
  context: { before: "", selected: "selected", after: "" },
  comment: "note",
}

const secondAnnotation = {
  ...annotation,
  id: "draft-2",
  index: 2,
  context: { before: "", selected: "second selection", after: "" },
  comment: "second note",
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function root() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return element
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

async function hoverTick(delay = 10) {
  await tick()
  await new Promise((resolve) => setTimeout(resolve, delay))
  await tick()
}

function hoverTrigger(element: HTMLElement, enter: boolean) {
  element.dispatchEvent(
    new PointerEvent(enter ? "pointerenter" : "pointerleave", {
      bubbles: true,
      pointerType: "mouse",
    }),
  )
}

export async function editorFocusCheck() {
  const element = root()
  const dispose = render(
    () => <ResponseAnnotationDraftList annotations={[annotation]} onSave={() => {}} onDelete={() => {}} />,
    element,
  )
  try {
    element.querySelector<HTMLButtonElement>('[aria-label="Edit annotation 1"]')?.click()
    await tick()
    check(document.activeElement === element.querySelector("textarea"), "editing must focus the annotation textarea")
    const editor = element.querySelector("textarea")?.parentElement
    check(
      editor?.classList.contains("bg-surface-base") && !editor.classList.contains("border"),
      "draft editor must use a surface background instead of a persistent border",
    )
  } finally {
    dispose()
    element.remove()
  }
}

export async function hoverInteractionCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationReference annotation={annotation} />, element)
  try {
    const trigger = element.querySelector<HTMLElement>('[aria-label="Open annotation 1"]')
    check(trigger, "reference trigger must exist")
    check(trigger.tagName === "SPAN", "reference must not expose a clickable button")
    const hover = element.querySelector<HTMLElement>('[data-slot="response-annotation-hover-trigger"]')
    check(hover, "reference hover trigger must exist")
    trigger.focus()
    hoverTrigger(hover, true)
    await hoverTick()
    check(
      document.querySelector('[data-slot="response-annotation-hover-details"]'),
      "mouseenter must show hover details",
    )
    check(document.activeElement === trigger, "mouseenter must not steal keyboard focus")

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await tick()
    check(!document.querySelector('[role="dialog"]'), "click must not open annotation details")

    trigger.blur()
    await hoverTick(140)
    hoverTrigger(hover, true)
    await hoverTick()
    hoverTrigger(hover, false)
    document.body.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 9999, clientY: 9999 }),
    )
    await hoverTick(140)
    const closedHoverDetails = document.querySelector<HTMLElement>('[data-slot="response-annotation-hover-details"]')
    check(!closedHoverDetails || closedHoverDetails.hasAttribute("data-closed"), "mouseleave must close hover details")
  } finally {
    dispose()
    element.remove()
  }
}

export async function referencePresentationCheck() {
  const element = root()
  element.style.overflow = "hidden"
  const selected = "完整所选文本 ".repeat(30).trim()
  const comment = "完整用户评论 ".repeat(30).trim()
  const dispose = render(
    () => <ResponseAnnotationReference annotation={{ ...annotation, context: { selected }, comment }} />,
    element,
  )
  try {
    const trigger = element.querySelector<HTMLElement>('[aria-label="Open annotation 1"]')
    check(trigger, "reference trigger must exist")
    check(trigger.classList.contains("underline"), "reference trigger must look like a link before hover")
    const reference = element.querySelector<HTMLElement>('[data-component="response-annotation-reference"]')
    check(reference, "reference root must exist")
    check(
      trigger.classList.contains("text-inherit") &&
        (reference.getAttribute("style") ?? "").includes("--v2-text-text-accent") &&
        (reference.getAttribute("style") ?? "").includes("--blue-dark-10"),
      "reference trigger must inherit a V2 and V1 compatible link accent color",
    )

    const hover = element.querySelector<HTMLElement>('[data-slot="response-annotation-hover-trigger"]')
    check(hover, "reference hover trigger must exist")
    hoverTrigger(hover, true)
    await hoverTick()
    const details = document.querySelector<HTMLElement>('[data-slot="response-annotation-hover-details"]')
    check(details, "hover details must exist")
    check(!element.contains(details), "hover details must use a portal outside the clipping message container")
    check(details.textContent?.includes(selected), "hover details must retain the complete selected text")
    check(details.textContent?.includes(comment), "hover details must retain the complete user comment")
    check(details.classList.contains("overflow-y-auto"), "long hover details must scroll inside a viewport bound")
    check(
      details.classList.contains("bg-surface-raised-base") &&
        !details.classList.contains("border") &&
        !details.classList.contains("divide-y"),
      "annotation details must use raised background and spacing instead of border lines",
    )
    const item = details.querySelector<HTMLElement>('[data-component="response-annotation-detail"]')
    check(item, "reference details must use the shared history detail layout")
    check(
      item.className === "grid grid-cols-[20px_minmax(0,1fr)] gap-2 py-3",
      "reference details must match the history item grid and spacing",
    )
    check(
      item.querySelector<HTMLElement>('[data-slot="response-annotation-detail-index"]')?.textContent === "1.",
      "reference details must display the annotation index like history details",
    )
    check(!item.querySelector(".rounded-lg, .border-t"), "reference details must not keep its separate card styling")
  } finally {
    dispose()
    element.remove()
  }
}

export async function keyboardInteractionCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationReference annotation={annotation} />, element)
  try {
    const trigger = element.querySelector<HTMLElement>('[aria-label="Open annotation 1"]')
    check(trigger, "reference trigger must exist")
    check(trigger.tagName === "SPAN", "reference must not expose button keyboard semantics")
    check(trigger.tabIndex === 0, "reference must remain keyboard focusable")
    trigger.focus()
    await hoverTick()
    check(
      document.querySelector('[data-slot="response-annotation-hover-details"]'),
      "keyboard focus must show hover details",
    )
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    await tick()
    check(!document.querySelector('[role="dialog"]'), "Enter and Space must not open a click dialog")
  } finally {
    dispose()
    element.remove()
  }
}

export async function historySummaryCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationHistoryList annotations={[annotation, secondAnnotation]} />, element)
  try {
    const trigger = element.querySelector<HTMLButtonElement>('[data-component="response-annotation-history-trigger"]')
    check(trigger, "history must render one compact count trigger")
    check(
      trigger.classList.contains("bg-surface-raised-base") && !trigger.classList.contains("border"),
      "history trigger must use a filled surface instead of a persistent border",
    )
    check(
      trigger.textContent?.includes("2 annotations"),
      "history trigger must aggregate every annotation in the message",
    )
    check(
      !element.querySelector('[data-component="response-annotation-history-details"]'),
      "history details must be hidden by default",
    )
    check(
      element.querySelectorAll('[data-component="response-annotation-history-trigger"]').length === 1,
      "history must use one trigger",
    )
  } finally {
    dispose()
    element.remove()
  }
}

export async function historyFocusCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationHistoryList annotations={[annotation, secondAnnotation]} />, element)
  try {
    const trigger = element.querySelector<HTMLButtonElement>('[data-component="response-annotation-history-trigger"]')
    check(trigger, "history trigger must exist")

    trigger.focus()
    await hoverTick()
    const details = document.querySelector<HTMLElement>('[data-component="response-annotation-history-details"]')
    check(details, "focusing the history count must show annotation details")
    check(details.textContent?.includes("selected"), "history details must include the first selected text")
    check(details.textContent?.includes("note"), "history details must include the first user comment")
    check(details.textContent?.includes("second selection"), "history details must include every selected text")

    check(!details.querySelector("button"), "historical annotation details must not expose source navigation")
  } finally {
    dispose()
    element.remove()
  }
}

export function provenanceCheck() {
  const element = root()
  const mounts = new AnnotationReferenceMounts()
  try {
    element.innerHTML =
      '<a href="#bluedcode-response-annotation-1">look</a><a href="#bluedcode-response-annotation-1">raw</a>'
    mounts.mount(element, [annotation], "capability")
    check(!element.querySelector('[data-component="response-annotation-reference"]'), "ordinary anchors must not mount")
    check(element.querySelectorAll("a").length === 2, "ordinary anchors must remain unchanged")
  } finally {
    mounts.clear(element)
    element.remove()
  }
}

export function noClickActionCheck() {
  const element = root()
  const mounts = new AnnotationReferenceMounts()
  const calls: number[] = []
  try {
    element.innerHTML = '<a href="#bluedcode-response-annotation-capability-1">annotation</a>'
    mounts.mount(element, [annotation], "capability", (value) => calls.push(value.index))
    check(
      element.querySelector<HTMLElement>('[data-component="response-annotation-reference"]')?.dataset
        .responseAnnotationDirective === ':bluedcode-annotation{index="1"}',
      "a mounted annotation reference must retain the replaced source directive for projection mapping",
    )
    element
      .querySelector<HTMLElement>('[aria-label="Open annotation 1"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    check(!document.querySelector('[role="dialog"]'), "reference click must not create a dialog")
    check(calls.length === 0, "reference click must not call a source action")
  } finally {
    mounts.clear(element)
    element.remove()
  }
}
