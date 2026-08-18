import { render } from "solid-js/web"
import type { ResponseAnnotation } from "@opencode-ai/core/session/response-annotation"
import { AnnotationReferenceMounts } from "./annotation-reference-mounts"
import { ResponseAnnotationDraftList, ResponseAnnotationReference } from "./response-annotation"

const annotation = {
  id: "draft-1",
  index: 1,
  source: { messageID: "message", partID: "part", start: 0, end: 8, digest: "sha256:x" },
  context: { before: "", selected: "selected", after: "" },
  comment: "note",
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

function keyboardActivate(trigger: HTMLButtonElement, key: "Enter" | " ") {
  const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  const allowed = trigger.dispatchEvent(down)
  if (allowed && key === "Enter") trigger.click()
  const up = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true })
  const allowedUp = trigger.dispatchEvent(up)
  if (allowed && allowedUp && key === " ") trigger.click()
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
  } finally {
    dispose()
    element.remove()
  }
}

export async function hoverInteractionCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationReference annotation={annotation} />, element)
  try {
    const trigger = element.querySelector<HTMLButtonElement>('[aria-label="Open annotation 1"]')
    check(trigger, "reference trigger must exist")
    trigger.focus()
    trigger.dispatchEvent(new MouseEvent("mouseenter"))
    await tick()
    check(element.querySelector('[data-slot="response-annotation-hover-details"]'), "mouseenter must show hover details")
    check(document.activeElement === trigger, "mouseenter must not steal keyboard focus")

    trigger.click()
    await tick()
    check(!element.querySelector('[data-slot="response-annotation-hover-details"]'), "click after hover must close hover details")
    check(element.querySelector('[role="dialog"]'), "click after hover must open press details")
    element.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click()
    await tick()

    trigger.dispatchEvent(new MouseEvent("mouseenter"))
    await tick()
    trigger.dispatchEvent(new MouseEvent("mouseleave"))
    await tick()
    check(!element.querySelector('[data-slot="response-annotation-hover-details"]'), "mouseleave must close hover details")
  } finally {
    dispose()
    element.remove()
  }
}

export async function keyboardInteractionCheck() {
  const element = root()
  const dispose = render(() => <ResponseAnnotationReference annotation={annotation} />, element)
  try {
    const trigger = element.querySelector<HTMLButtonElement>('[aria-label="Open annotation 1"]')
    check(trigger, "reference trigger must exist")
    check(trigger.type === "button", "reference trigger must use native button keyboard semantics")
    trigger.focus()
    keyboardActivate(trigger, "Enter")
    await tick()
    const details = element.querySelector<HTMLElement>('[role="dialog"][aria-label="Annotation 1 details"]')
    check(details, "keyboard-generated click must open reference details")
    check(document.activeElement === details, "activated details must receive focus")

    details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await tick()
    check(trigger.getAttribute("aria-expanded") === "false", "Escape must close reference details")
    check(document.activeElement === trigger, "Escape must return focus to the trigger")

    keyboardActivate(trigger, " ")
    await tick()
    check(element.querySelector('[role="dialog"]'), "Space activation must open reference details")
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

export function sourceNavigationCheck() {
  const element = root()
  const mounts = new AnnotationReferenceMounts()
  const calls: number[] = []
  try {
    element.innerHTML = '<a href="#bluedcode-response-annotation-capability-1">annotation</a>'
    mounts.mount(element, [annotation], "capability", (value) => calls.push(value.index))
    element.querySelector<HTMLButtonElement>('[aria-label="Open annotation 1"]')?.click()
    element.querySelectorAll<HTMLButtonElement>("button")[1]?.click()
    check(calls.join(",") === "1", "reference source action must call the App navigation callback")
  } finally {
    mounts.clear(element)
    element.remove()
  }
}

export function unavailableSourceNavigationCheck() {
  const element = root()
  const mounts = new AnnotationReferenceMounts()
  try {
    element.innerHTML = '<a href="#bluedcode-response-annotation-capability-1">annotation</a>'
    const mount = mounts.mount as (
      root: Element,
      annotations: ResponseAnnotation[],
      token: string,
      onBackToSource?: (annotation: ResponseAnnotation) => void,
      sourceAvailable?: (annotation: ResponseAnnotation) => boolean,
    ) => void
    mount.call(mounts, element, [annotation], "capability", () => {}, () => false)
    element.querySelector<HTMLButtonElement>('[aria-label="Open annotation 1"]')?.click()
    check(
      ![...element.querySelectorAll("button")].some((button) => button.textContent === "Back to source"),
      "an unavailable Assistant source must not render a source action",
    )
  } finally {
    mounts.clear(element)
    element.remove()
  }
}
