import { digestProjection, projectAnnotationText, sliceAnnotationContext } from "@opencode-ai/core/session/response-annotation"
import { createStore } from "solid-js/store"
import { onCleanup, onMount, Show, type Accessor } from "solid-js"
import type { ResponseAnnotationDraft } from "@/context/prompt"

type AnnotationPart = {
  markdown: string
}

type AnnotationSource = {
  messageID: string
  partID: string
  start: number
  end: number
}

type SelectionInput = {
  root: HTMLElement
  selection: Selection
  sessionID: string
  id: string
  createdAt: number
  getPart: (messageID: string, partID: string) => AnnotationPart | undefined
}

export function responseAnnotationDraftFromSelection(input: SelectionInput): ResponseAnnotationDraft | undefined {
  if (input.selection.rangeCount !== 1 || input.selection.isCollapsed) return
  const range = input.selection.getRangeAt(0)
  const startPart = timelinePart(range.startContainer)
  const endPart = timelinePart(range.endContainer)
  if (!startPart || startPart !== endPart || !input.root.contains(startPart)) return
  if (startPart.dataset.timelinePartRole !== "assistant") return
  if (startPart.dataset.timelinePartType !== "text") return
  if (startPart.dataset.timelinePartCompleted !== "true") return

  const messageID = startPart.dataset.timelineMessageId
  const partID = startPart.dataset.timelinePartId
  if (!messageID || !partID) return
  const part = input.getPart(messageID, partID)
  if (!part) return
  const projection = projectAnnotationText(part.markdown)
  const markdownRoot = startPart.querySelector<HTMLElement>('[data-component="markdown"]') ?? startPart
  const positions = mapTextNodes(markdownRoot, projection.text)
  const start = projectionOffset(positions, range.startContainer, range.startOffset)
  const end = projectionOffset(positions, range.endContainer, range.endOffset)
  if (start === undefined || end === undefined || start >= end || end - start > 4_000) return
  const context = sliceAnnotationContext(projection, start, end)
  if (!context.selected) return

  return {
    id: input.id,
    source: {
      sessionID: input.sessionID,
      messageID,
      partID,
      partDigest: digestProjection(part.markdown),
      start,
      end,
    },
    context,
    comment: "",
    createdAt: input.createdAt,
  }
}

export function ResponseAnnotationSelection(props: {
  root: Accessor<HTMLElement | undefined>
  sessionID: string
  label: string
  getPart: (messageID: string, partID: string) => AnnotationPart | undefined
  onAdd: (draft: ResponseAnnotationDraft) => void
}) {
  const [state, setState] = createStore<{
    draft?: ResponseAnnotationDraft
    position?: { x: number; y: number }
  }>({})
  let frame: number | undefined

  const refresh = () => {
    frame = undefined
    const root = props.root()
    const selection = document.getSelection()
    if (!root || !selection) {
      setState({ draft: undefined, position: undefined })
      return
    }
    const draft = responseAnnotationDraftFromSelection({
      root,
      selection,
      sessionID: props.sessionID,
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      createdAt: Date.now(),
      getPart: props.getPart,
    })
    if (!draft) {
      setState({ draft: undefined, position: undefined })
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    setState({ draft, position: { x: rect.left + rect.width / 2, y: rect.top } })
  }
  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(refresh)
  }

  onMount(() => {
    document.addEventListener("selectionchange", schedule)
    window.addEventListener("resize", schedule)
    props.root()?.addEventListener("scroll", schedule, true)
  })
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    document.removeEventListener("selectionchange", schedule)
    window.removeEventListener("resize", schedule)
    props.root()?.removeEventListener("scroll", schedule, true)
  })

  return (
    <Show when={state.draft && state.position}>
      <button
        type="button"
        data-component="response-annotation-selection-action"
        class="fixed z-[9999] -translate-x-1/2 -translate-y-full rounded-md border border-border-subtle bg-background-strong px-3 py-2 text-12-medium text-text-strong shadow-lg"
        style={{ left: `${state.position!.x}px`, top: `${state.position!.y - 8}px` }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          props.onAdd(state.draft!)
          document.getSelection()?.removeAllRanges()
          setState({ draft: undefined, position: undefined })
        }}
      >
        {props.label}
      </button>
    </Show>
  )
}

export function createResponseAnnotationSourceNavigator(input: {
  root: Accessor<HTMLElement | undefined>
  revealMessage: (messageID: string) => void
  getPart: (messageID: string, partID: string) => AnnotationPart | undefined
  duration?: number
}) {
  let frame: number | undefined
  let settlePoll: ((result: boolean) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let highlighted: HTMLElement | undefined
  let overlays: HTMLElement[] = []

  const clear = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    settlePoll?.(false)
    if (timeout !== undefined) clearTimeout(timeout)
    frame = undefined
    settlePoll = undefined
    timeout = undefined
    highlighted?.removeAttribute("data-response-annotation-highlight")
    highlighted?.removeAttribute("data-response-annotation-highlight-start")
    highlighted?.removeAttribute("data-response-annotation-highlight-end")
    highlighted = undefined
    overlays.forEach((overlay) => overlay.remove())
    overlays = []
  }
  const available = (source: AnnotationSource) => {
    const part = input.getPart(source.messageID, source.partID)
    if (!part) return false
    const size = Array.from(projectAnnotationText(part.markdown).text).length
    return source.start >= 0 && source.end > source.start && source.end <= size
  }
  const mark = (source: AnnotationSource) => {
    const root = input.root()
    if (!root) return false
    const element = [...root.querySelectorAll<HTMLElement>("[data-timeline-message-id][data-timeline-part-id]")].find(
      (candidate) =>
        candidate.dataset.timelineMessageId === source.messageID && candidate.dataset.timelinePartId === source.partID,
    )
    if (!element) return false
    const part = input.getPart(source.messageID, source.partID)
    if (!part) return false
    element.scrollIntoView({ block: "center" })
    element.dataset.responseAnnotationHighlight = ""
    element.dataset.responseAnnotationHighlightStart = String(source.start)
    element.dataset.responseAnnotationHighlightEnd = String(source.end)
    highlighted = element
    overlays = sourceHighlightOverlays(element, part.markdown, source.start, source.end)
    timeout = setTimeout(clear, input.duration ?? 1_600)
    return true
  }
  const waitForMark = (source: AnnotationSource) =>
    new Promise<boolean>((resolve) => {
      const started = performance.now()
      settlePoll = resolve
      const poll = () => {
        frame = undefined
        if (mark(source)) {
          settlePoll = undefined
          resolve(true)
          return
        }
        if (performance.now() - started >= 1_000) {
          settlePoll = undefined
          resolve(false)
          return
        }
        frame = requestAnimationFrame(poll)
      }
      frame = requestAnimationFrame(poll)
    })
  const go = async (source: AnnotationSource) => {
    if (!available(source)) return false
    clear()
    input.revealMessage(source.messageID)
    if (mark(source)) return true
    return waitForMark(source)
  }

  return { available, go, dispose: clear }
}

function timelinePart(node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>(
    "[data-timeline-message-id][data-timeline-part-id][data-timeline-part-role][data-timeline-part-type]",
  )
}

function mapTextNodes(root: HTMLElement, projected: string) {
  const result = new Map<Text, number[]>()
  const text = Array.from(projected)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0
  let mapped = false
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement
    const ignored = parent?.closest(
      '[data-slot="markdown-copy-button"], [data-component="response-annotation-reference"], [aria-hidden="true"]',
    )
    const value = Array.from(node.data)
    if (ignored || value.length === 0) {
      current = walker.nextNode()
      continue
    }
    const positions = new Array<number>(value.length + 1)
    if (mapped && !whitespace(value[0]!)) {
      while (cursor < text.length && whitespace(text[cursor]!)) cursor++
    }
    positions[0] = cursor
    for (let index = 0; index < value.length; ) {
      if (!whitespace(value[index]!)) {
        if (text[cursor] !== value[index]) return new Map()
        cursor++
        index++
        positions[index] = cursor
        continue
      }

      let nodeEnd = index + 1
      while (nodeEnd < value.length && whitespace(value[nodeEnd]!)) nodeEnd++
      let projectionEnd = cursor
      while (projectionEnd < text.length && whitespace(text[projectionEnd]!)) projectionEnd++
      if (projectionEnd === cursor) {
        if (index !== 0 || nodeEnd !== value.length) return new Map()
        for (let point = index + 1; point <= nodeEnd; point++) positions[point] = cursor
        index = nodeEnd
        continue
      }
      const nodeSize = nodeEnd - index
      const projectionSize = projectionEnd - cursor
      for (let point = 1; point <= nodeSize; point++) {
        positions[index + point] = cursor + Math.floor((point * projectionSize) / nodeSize)
      }
      cursor = projectionEnd
      index = nodeEnd
    }
    result.set(node, positions)
    mapped = true
    current = walker.nextNode()
  }
  while (cursor < text.length && whitespace(text[cursor]!)) cursor++
  if (cursor !== text.length) return new Map()
  return result
}

function whitespace(value: string) {
  return /\s/u.test(value)
}

function projectionOffset(positions: Map<Text, number[]>, node: Node, offset: number) {
  if (!(node instanceof Text)) return
  const position = positions.get(node)
  if (!position) return
  const point = Array.from(node.data.slice(0, offset)).length
  return position[point]
}

function sourceHighlightOverlays(element: HTMLElement, markdown: string, start: number, end: number) {
  const markdownRoot = element.querySelector<HTMLElement>('[data-component="markdown"]') ?? element
  const positions = mapTextNodes(markdownRoot, projectAnnotationText(markdown).text)
  const first = boundaryForProjection(positions, start)
  const last = boundaryForProjection(positions, end)
  if (!first || !last) return []
  const range = document.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset)
  if (typeof range.getClientRects !== "function") return []
  return [...range.getClientRects()].map((rect) => {
    const overlay = document.createElement("div")
    overlay.dataset.responseAnnotationHighlightOverlay = ""
    overlay.className = "fixed z-40 pointer-events-none rounded-sm bg-warning-base/25"
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    document.body.appendChild(overlay)
    return overlay
  })
}

function boundaryForProjection(positions: Map<Text, number[]>, offset: number) {
  for (const [node, position] of positions) {
    const point = position.indexOf(offset)
    if (point < 0) continue
    return {
      node,
      offset: Array.from(node.data).slice(0, point).join("").length,
    }
  }
}
