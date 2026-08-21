import {
  annotationSourceMatches,
  digestProjection,
  projectAnnotationText,
  sliceAnnotationContext,
} from "@opencode-ai/core/session/response-annotation"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import type { ResponseAnnotationDraft } from "@/context/prompt"
import { Icon } from "@opencode-ai/ui/icon"

type AnnotationPart = {
  markdown: string
}

type AnnotationSource = {
  messageID: string
  partID: string
  start: number
  end: number
}

export const RESPONSE_ANNOTATION_COMMENT_LIMIT = 2_000

export function responseAnnotationCommentLength(value: string) {
  return Array.from(value).length
}

type SelectionInput = {
  root: HTMLElement
  selection: Selection
  sessionID: string
  id: string
  createdAt: number
  getPart: (messageID: string, partID: string) => AnnotationPart | undefined
}

type BrowserHighlightAPI = {
  registry: {
    delete: (name: string) => unknown
    set: (name: string, highlight: unknown) => unknown
  }
  Highlight: new (...ranges: Range[]) => unknown
}

let responseAnnotationHighlightIndex = 0

function browserHighlightAPI(): BrowserHighlightAPI | undefined {
  const browser = globalThis as unknown as {
    CSS?: { highlights?: BrowserHighlightAPI["registry"] }
    Highlight?: BrowserHighlightAPI["Highlight"]
  }
  if (!browser.CSS?.highlights || typeof browser.Highlight !== "function") return
  return { registry: browser.CSS.highlights, Highlight: browser.Highlight }
}

function clearBrowserHighlights(names: { normal: string; active: string }) {
  const api = browserHighlightAPI()
  api?.registry.delete(names.normal)
  api?.registry.delete(names.active)
}

function setBrowserHighlights(names: { normal: string; active: string }, normal: Range[], active: Range[]) {
  const api = browserHighlightAPI()
  if (!api) return
  clearBrowserHighlights(names)
  if (normal.length > 0) api.registry.set(names.normal, new api.Highlight(...normal))
  if (active.length > 0) api.registry.set(names.active, new api.Highlight(...active))
}

function installBrowserHighlightStyles(names: { normal: string; active: string }) {
  const style = document.createElement("style")
  style.dataset.responseAnnotationHighlightStyle = ""
  style.textContent = `
    ::highlight(${names.normal}) {
      background-color: rgb(from var(--icon-interactive-base) r g b / 0.26);
    }
    ::highlight(${names.active}) {
      background-color: rgb(from var(--icon-interactive-base) r g b / 0.5);
    }
  `
  document.head.appendChild(style)
  return style
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
  const exact = {
    start: projectionOffset(positions, range.startContainer, range.startOffset),
    end: projectionOffset(positions, range.endContainer, range.endOffset),
  }
  const fallback =
    exact.start === undefined || exact.end === undefined
      ? selectedTextRange(projection.text, input.selection.toString(), selectionContext(markdownRoot, range))
      : undefined
  const start = exact.start ?? fallback?.start
  const end = exact.end ?? fallback?.end
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
  cancelLabel: string
  saveLabel: string
  deleteLabel?: string
  getPart: (messageID: string, partID: string) => AnnotationPart | undefined
  annotations?: Accessor<ResponseAnnotationDraft[]>
  onAdd: (draft: ResponseAnnotationDraft) => void
  onUpdate?: (id: string, comment: string) => void
  onRemove?: (id: string) => void
}) {
  const [state, setState] = createStore<{
    draft?: ResponseAnnotationDraft
    position?: { actionX: number; actionY: number; actionBelow: boolean; editorX: number; editorY: number }
    editing: boolean
    comment: string
  }>({ editing: false, comment: "" })
  let frame: number | undefined
  let markerFrame: number | undefined
  let pointerSelecting = false
  let badgeLayer: HTMLDivElement | undefined
  let badgeRoot: HTMLElement | undefined
  const badgeElements = new Map<string, HTMLButtonElement>()
  let restoreRootPosition: string | undefined
  const highlightID = ++responseAnnotationHighlightIndex
  const highlightNames = {
    normal: `bluedcode-response-annotation-${highlightID}`,
    active: `bluedcode-response-annotation-${highlightID}-active`,
  }
  let highlightStyle: HTMLStyleElement | undefined
  let actionButton: HTMLButtonElement | undefined
  let focusActionAfterRefresh = false

  const clearMarkers = () => {
    clearBrowserHighlights(highlightNames)
    badgeElements.forEach((badge) => badge.remove())
    badgeElements.clear()
  }

  const destroyBadgeLayer = () => {
    clearMarkers()
    badgeLayer?.remove()
    badgeLayer = undefined
    if (badgeRoot && restoreRootPosition !== undefined) badgeRoot.style.position = restoreRootPosition
    badgeRoot = undefined
    restoreRootPosition = undefined
  }

  const ensureBadgeLayer = () => {
    const root = props.root()
    if (!root?.isConnected) return
    if (badgeLayer?.isConnected && badgeRoot === root) return badgeLayer
    destroyBadgeLayer()
    badgeRoot = root
    if (getComputedStyle(root).position === "static") {
      restoreRootPosition = root.style.position
      root.style.position = "relative"
    }
    badgeLayer = document.createElement("div")
    badgeLayer.dataset.component = "response-annotation-source-layer"
    badgeLayer.style.position = "absolute"
    badgeLayer.style.inset = "0"
    badgeLayer.style.pointerEvents = "none"
    badgeLayer.style.zIndex = "5"
    root.appendChild(badgeLayer)
    return badgeLayer
  }

  const sourceElement = (draft: ResponseAnnotationDraft) => {
    const root = props.root()
    if (!root || draft.source.sessionID !== props.sessionID) return
    return [...root.querySelectorAll<HTMLElement>("[data-timeline-message-id][data-timeline-part-id]")].find(
      (candidate) =>
        candidate.dataset.timelineMessageId === draft.source.messageID &&
        candidate.dataset.timelinePartId === draft.source.partID,
    )
  }

  const markerDrafts = () => {
    const drafts = props.annotations?.() ?? []
    const active = state.editing ? state.draft : undefined
    if (!active || drafts.some((draft) => draft.id === active.id)) return drafts
    return [...drafts, active]
  }

  const markerRange = (draft: ResponseAnnotationDraft) => {
    const element = sourceElement(draft)
    const part = props.getPart(draft.source.messageID, draft.source.partID)
    if (!element || !part) return
    if (digestProjection(part.markdown) !== draft.source.partDigest) return
    return responseAnnotationRangeFromSource(element, part.markdown, draft.source.start, draft.source.end)
  }

  const sourceValid = (draft: ResponseAnnotationDraft) => {
    const part = props.getPart(draft.source.messageID, draft.source.partID)
    if (!part) return false
    return annotationSourceMatches(
      {
        source: { ...draft.source, digest: draft.source.partDigest },
        context: draft.context,
      },
      part.markdown,
    )
  }

  const rangePosition = (range: Range) => {
    const rect = range.getBoundingClientRect()
    const lines = [...range.getClientRects()].filter((candidate) => candidate.width > 0 && candidate.height > 0)
    const first = lines.sort((a, b) => a.top - b.top || a.left - b.left)[0] ?? rect
    const last = lines.sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0] ?? rect
    const editorWidth = Math.min(320, Math.max(0, window.innerWidth - 24))
    const editorHeight = 144
    const rightEditorX = last.right + 36
    const leftEditorX = first.left - editorWidth - 12
    const fitsRight = rightEditorX + editorWidth <= window.innerWidth - 12
    const fitsLeft = leftEditorX >= 12
    const editorX = fitsRight
      ? rightEditorX
      : fitsLeft
        ? leftEditorX
        : Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - editorWidth - 12))
    const editorY =
      fitsRight || fitsLeft
        ? Math.min(Math.max(rect.top, 12), Math.max(12, window.innerHeight - editorHeight - 12))
        : rect.bottom + 12 + editorHeight <= window.innerHeight - 12
          ? rect.bottom + 12
          : Math.max(12, rect.top - editorHeight - 12)
    return {
      actionX: Math.min(Math.max(first.left + first.width / 2, 56), Math.max(56, window.innerWidth - 56)),
      actionY: first.top >= 44 ? first.top - 8 : first.bottom + 8,
      actionBelow: first.top < 44,
      editorX,
      editorY,
      badgeX: last.right + 5,
      badgeY: last.top,
    }
  }

  const openDraftEditor = (draft: ResponseAnnotationDraft) => {
    const range = markerRange(draft)
    if (!range) return
    const position = rangePosition(range)
    setState({
      draft,
      position: {
        actionX: position.actionX,
        actionY: position.actionY,
        actionBelow: position.actionBelow,
        editorX: position.editorX,
        editorY: position.editorY,
      },
      editing: true,
      comment: draft.comment,
    })
  }

  const renderMarkers = () => {
    markerFrame = undefined
    clearBrowserHighlights(highlightNames)
    const layer = ensureBadgeLayer()
    const root = props.root()
    if (!layer || !root) return
    const rootRect = root.getBoundingClientRect()
    const normalRanges: Range[] = []
    const activeRanges: Range[] = []
    const visibleBadges = new Set<string>()
    markerDrafts().forEach((draft, index) => {
      const range = markerRange(draft)
      if (!range || typeof range.getClientRects !== "function") return
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
      if (rects.length === 0) return
      const active = state.editing && state.draft?.id === draft.id
      ;(active ? activeRanges : normalRanges).push(range)
      const last = rects.sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0]!
      const hasRootGeometry = rootRect.width > 0 || rootRect.height > 0
      const visible =
        !hasRootGeometry ||
        (last.right > Math.max(rootRect.left, 0) &&
          last.left < Math.min(rootRect.right, window.innerWidth) &&
          last.bottom > Math.max(rootRect.top, 0) &&
          last.top < Math.min(rootRect.bottom, window.innerHeight))
      if (!visible) return
      const badge = badgeElements.get(draft.id) ?? document.createElement("button")
      badge.type = "button"
      badge.dataset.component = "response-annotation-source-badge"
      badge.dataset.annotationId = draft.id
      badge.toggleAttribute("data-active", active)
      badge.textContent = String(index + 1)
      badge.className =
        "absolute flex size-6 items-center justify-center rounded-full text-11-medium shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      badge.style.left = `${last.right - rootRect.left + root.scrollLeft + 5}px`
      badge.style.top = `${last.top - rootRect.top + root.scrollTop}px`
      badge.style.transform = "translateY(-50%)"
      badge.style.zIndex = "1"
      badge.style.backgroundColor = "var(--icon-interactive-base)"
      badge.style.color = "var(--text-on-interactive-base)"
      badge.style.pointerEvents = "auto"
      badge.ariaLabel = `${props.label} ${index + 1}`
      badge.onmousedown = (event) => event.preventDefault()
      badge.onclick = () => openDraftEditor(draft)
      if (!badge.isConnected) layer.appendChild(badge)
      badgeElements.set(draft.id, badge)
      visibleBadges.add(draft.id)
    })
    badgeElements.forEach((badge, id) => {
      if (visibleBadges.has(id)) return
      badge.remove()
      badgeElements.delete(id)
    })
    setBrowserHighlights(highlightNames, normalRanges, activeRanges)
  }

  const scheduleMarkers = () => {
    if (markerFrame !== undefined) cancelAnimationFrame(markerFrame)
    markerFrame = requestAnimationFrame(renderMarkers)
  }

  const refresh = () => {
    frame = undefined
    if (state.editing && state.draft) {
      const element = sourceElement(state.draft)
      if (!element?.isConnected || !sourceValid(state.draft)) {
        setState({ draft: undefined, position: undefined, editing: false, comment: "" })
        return
      }
      const range = markerRange(state.draft)
      if (!range) return
      const position = rangePosition(range)
      setState("position", {
        actionX: position.actionX,
        actionY: position.actionY,
        actionBelow: position.actionBelow,
        editorX: position.editorX,
        editorY: position.editorY,
      })
      return
    }
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
    const position = rangePosition(selection.getRangeAt(0))
    setState({
      draft,
      position: {
        actionX: position.actionX,
        actionY: position.actionY,
        actionBelow: position.actionBelow,
        editorX: position.editorX,
        editorY: position.editorY,
      },
    })
    if (focusActionAfterRefresh) {
      focusActionAfterRefresh = false
      queueMicrotask(() => actionButton?.focus())
    }
  }
  const schedule = () => {
    if (pointerSelecting) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(refresh)
  }
  const startPointerSelection = (event: PointerEvent) => {
    if (event.button !== 0) return
    const root = props.root()
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return
    pointerSelecting = true
    const active = document.activeElement
    if (active instanceof HTMLElement && active.isContentEditable && !root.contains(active)) {
      active.blur()
      document.getSelection()?.removeAllRanges()
    }
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    if (!state.editing) setState({ draft: undefined, position: undefined })
  }
  const finishPointerSelection = () => {
    if (!pointerSelecting) return
    pointerSelecting = false
    schedule()
  }
  const finishKeyboardSelection = (event: KeyboardEvent) => {
    if (!event.shiftKey || !document.getSelection() || document.getSelection()!.isCollapsed) return
    focusActionAfterRefresh = true
    schedule()
  }

  onMount(() => {
    highlightStyle = installBrowserHighlightStyles(highlightNames)
    document.addEventListener("pointerdown", startPointerSelection)
    document.addEventListener("selectionchange", schedule)
    document.addEventListener("mouseup", schedule)
    document.addEventListener("pointerup", finishPointerSelection)
    document.addEventListener("pointercancel", finishPointerSelection)
    document.addEventListener("keyup", finishKeyboardSelection)
    window.addEventListener("resize", schedule)
    window.addEventListener("resize", scheduleMarkers)
  })
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (markerFrame !== undefined) cancelAnimationFrame(markerFrame)
    document.removeEventListener("pointerdown", startPointerSelection)
    document.removeEventListener("selectionchange", schedule)
    document.removeEventListener("mouseup", schedule)
    document.removeEventListener("pointerup", finishPointerSelection)
    document.removeEventListener("pointercancel", finishPointerSelection)
    document.removeEventListener("keyup", finishKeyboardSelection)
    window.removeEventListener("resize", schedule)
    window.removeEventListener("resize", scheduleMarkers)
    destroyBadgeLayer()
    highlightStyle?.remove()
    highlightStyle = undefined
  })

  createEffect(() => {
    props.annotations?.()
    state.editing
    state.draft?.id
    scheduleMarkers()
  })

  createEffect(() => {
    const root = props.root()
    if (!root) return
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            scheduleMarkers()
            schedule()
          })
    resize?.observe(root)
    void document.fonts?.ready?.then(() => {
      scheduleMarkers()
      schedule()
    })
    const observer = new MutationObserver((records) => {
      if (
        records.every(
          (record) =>
            badgeLayer &&
            (record.target === badgeLayer ||
              badgeLayer.contains(record.target) ||
              ([...record.addedNodes].every((node) => node === badgeLayer) && record.removedNodes.length === 0)),
        )
      )
        return
      scheduleMarkers()
      schedule()
    })
    observer.observe(root, { childList: true, subtree: true })
    root.addEventListener("scroll", scheduleMarkers, true)
    root.addEventListener("scroll", schedule, true)
    onCleanup(() => {
      resize?.disconnect()
      observer.disconnect()
      root.removeEventListener("scroll", scheduleMarkers, true)
      root.removeEventListener("scroll", schedule, true)
      if (badgeRoot === root) destroyBadgeLayer()
    })
    scheduleMarkers()
  })

  const closeEditor = () => {
    document.getSelection()?.removeAllRanges()
    setState({ draft: undefined, position: undefined, editing: false, comment: "" })
  }

  const saveEditor = (comment: string) => {
    const draft = state.draft
    if (!draft) return
    if (responseAnnotationCommentLength(comment) > RESPONSE_ANNOTATION_COMMENT_LIMIT) return
    const value = comment
    if (props.annotations?.().some((annotation) => annotation.id === draft.id)) props.onUpdate?.(draft.id, value)
    else props.onAdd({ ...draft, comment: value })
    closeEditor()
  }

  const deleteEditor = () => {
    const draft = state.draft
    if (!draft || !props.annotations?.().some((annotation) => annotation.id === draft.id)) return
    props.onRemove?.(draft.id)
    closeEditor()
  }

  return (
    <Portal>
      <Show when={state.draft && state.position}>
        <Show
          when={state.editing}
          fallback={
            <button
              ref={actionButton}
              type="button"
              data-component="response-annotation-selection-action"
              class="fixed z-[9999] flex h-8 items-center gap-1.5 rounded-lg bg-surface-raised-base px-2.5 text-12-medium text-text-strong shadow-lg transition-colors hover:bg-surface-raised-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              style={{
                left: `${state.position!.actionX}px`,
                top: `${state.position!.actionY}px`,
                transform: state.position!.actionBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setState({ editing: true, comment: "" })}
            >
              <Icon name="comment" size="small" class="text-icon-weak" />
              <span>{props.label}</span>
            </button>
          }
        >
          <div
            data-component="response-annotation-selection-editor"
            role="dialog"
            aria-label={props.label}
            class="fixed z-[9999] w-[min(320px,calc(100vw-24px))]"
            style={{ left: `${state.position!.editorX}px`, top: `${state.position!.editorY}px` }}
          >
            <ResponseAnnotationEditor
              value={state.comment}
              onInput={(comment) => setState("comment", comment)}
              onCancel={closeEditor}
              onSubmit={saveEditor}
              cancelLabel={props.cancelLabel}
              submitLabel={props.saveLabel}
              placeholder={`${props.label}…`}
              leadingActions={
                <Show when={props.annotations?.().some((annotation) => annotation.id === state.draft?.id)}>
                  <button
                    type="button"
                    data-component="response-annotation-selection-delete"
                    aria-label={props.deleteLabel ?? props.label}
                    class="flex size-7 items-center justify-center rounded-full text-icon-strong-base transition-colors hover:bg-surface-critical-base hover:text-icon-critical-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={deleteEditor}
                  >
                    <Icon name="trash" size="small" />
                  </button>
                </Show>
              }
            />
          </div>
        </Show>
      </Show>
    </Portal>
  )
}

function ResponseAnnotationEditor(props: {
  value: string
  onInput: (value: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  cancelLabel: string
  submitLabel: string
  placeholder: string
  leadingActions?: JSX.Element
}) {
  let textarea: HTMLTextAreaElement | undefined
  onMount(() => queueMicrotask(() => textarea?.focus()))
  const submit = () => {
    if (responseAnnotationCommentLength(props.value) > RESPONSE_ANNOTATION_COMMENT_LIMIT) return
    props.onSubmit(props.value)
  }
  return (
    <div
      data-component="response-annotation-editor"
      class="overflow-hidden rounded-[20px] bg-surface-raised-base shadow-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        props.onCancel()
      }}
    >
      <textarea
        ref={textarea}
        rows={3}
        value={props.value}
        class="block min-h-20 w-full resize-none bg-transparent px-4 pb-2 pt-3 text-13-regular text-text-strong outline-none placeholder:text-text-weaker"
        placeholder={props.placeholder}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === "Escape") {
            event.preventDefault()
            props.onCancel()
            return
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <Show when={responseAnnotationCommentLength(props.value) > RESPONSE_ANNOTATION_COMMENT_LIMIT}>
        <div role="alert" class="px-4 text-right text-11-regular text-text-critical">
          {responseAnnotationCommentLength(props.value)} / {RESPONSE_ANNOTATION_COMMENT_LIMIT}
        </div>
      </Show>
      <div data-slot="response-annotation-editor-actions" class="flex min-h-11 items-center gap-2 px-2.5 pb-2.5 pt-1">
        <div data-slot="response-annotation-editor-leading-actions" class="flex min-w-7 items-center">
          {props.leadingActions}
        </div>
        <div class="flex-1" />
        <button
          type="button"
          data-action="response-annotation-cancel"
          class="h-8 rounded-full bg-surface-raised-strong px-3 text-12-medium text-text-base transition-colors hover:bg-surface-raised-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          onClick={props.onCancel}
        >
          {props.cancelLabel}
        </button>
        <button
          type="button"
          data-action="response-annotation-save"
          disabled={responseAnnotationCommentLength(props.value) > RESPONSE_ANNOTATION_COMMENT_LIMIT}
          class="h-8 rounded-full bg-text-strong px-3 text-12-medium text-background-base transition-opacity disabled:opacity-40"
          onClick={submit}
        >
          {props.submitLabel}
        </button>
      </div>
    </div>
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
  const highlightID = ++responseAnnotationHighlightIndex
  const highlightNames = {
    normal: `bluedcode-response-annotation-navigation-${highlightID}`,
    active: `bluedcode-response-annotation-navigation-${highlightID}-active`,
  }
  let highlightStyle: HTMLStyleElement | undefined

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
    clearBrowserHighlights(highlightNames)
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
    const range = responseAnnotationRangeFromSource(element, part.markdown, source.start, source.end)
    if (range) {
      highlightStyle ??= installBrowserHighlightStyles(highlightNames)
      setBrowserHighlights(highlightNames, [], [range])
    }
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

  return {
    available,
    go,
    dispose: () => {
      clear()
      highlightStyle?.remove()
      highlightStyle = undefined
    },
  }
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
  const replacedDirectives = new Set<Element>()
  let cursor = 0
  let mapped = false
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement
    const reference = parent?.closest<HTMLElement>("[data-response-annotation-directive]")
    if (reference) {
      if (!replacedDirectives.has(reference)) {
        const directive = reference.dataset.responseAnnotationDirective
        const chars = Array.from(directive ?? "")
        if (!directive || text.slice(cursor, cursor + chars.length).join("") !== directive) return new Map()
        cursor += chars.length
        replacedDirectives.add(reference)
      }
      current = walker.nextNode()
      continue
    }
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
        if (index !== 0 && nodeEnd !== value.length) return new Map()
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

function selectionContext(root: HTMLElement, range: Range) {
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(root)
  after.setStart(range.endContainer, range.endOffset)
  return { before: before.toString(), after: after.toString() }
}

function selectedTextRange(projected: string, selected: string, context?: { before: string; after: string }) {
  const text = selected.replace(/\r\n?/g, "\n")
  if (!text.trim() || Array.from(text).length > 4_000) return
  const index = contextualTextIndex(projected, text, context)
  if (index === undefined) return
  const start = Array.from(projected.slice(0, index)).length
  return { start, end: start + Array.from(text).length }
}

function contextualTextIndex(value: string, selected: string, context?: { before: string; after: string }) {
  const candidates: number[] = []
  let cursor = 0
  while (cursor <= value.length - selected.length) {
    const index = value.indexOf(selected, cursor)
    if (index < 0) break
    candidates.push(index)
    cursor = index + Math.max(selected.length, 1)
  }
  if (candidates.length === 0) return
  if (candidates.length === 1) return candidates[0]
  if (!context) return
  return contextualCandidate(value, selected, candidates, context)
}

function contextualCandidate(
  projected: string,
  selected: string,
  candidates: number[],
  context: { before: string; after: string },
) {
  const expectedBefore = normalizeSelectionContext(context.before).slice(-160)
  const expectedAfter = normalizeSelectionContext(context.after).slice(0, 160)
  const ranked = candidates
    .map((index) => ({
      index,
      score:
        matchingSuffix(normalizeSelectionContext(projected.slice(0, index)).slice(-160), expectedBefore) +
        matchingPrefix(
          normalizeSelectionContext(projected.slice(index + selected.length)).slice(0, 160),
          expectedAfter,
        ),
    }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score === 0 || best.score === ranked[1]?.score) return
  return best.index
}

function normalizeSelectionContext(value: string) {
  return value.replace(/\s+/gu, " ").trim()
}

function matchingSuffix(left: string, right: string) {
  let size = 0
  while (size < left.length && size < right.length && left[left.length - size - 1] === right[right.length - size - 1])
    size++
  return size
}

function matchingPrefix(left: string, right: string) {
  let size = 0
  while (size < left.length && size < right.length && left[size] === right[size]) size++
  return size
}

export function responseAnnotationRangeFromSource(element: HTMLElement, markdown: string, start: number, end: number) {
  const markdownRoot = element.querySelector<HTMLElement>('[data-component="markdown"]') ?? element
  const projection = projectAnnotationText(markdown)
  const positions = mapTextNodes(markdownRoot, projection.text)
  const first = boundaryForProjection(positions, start)
  const last = boundaryForProjection(positions, end)
  if (first && last) {
    const range = document.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset)
    return range
  }
  return sourceRangeFromContext(markdownRoot, sliceAnnotationContext(projection, start, end))
}

function sourceRangeFromContext(root: HTMLElement, context: { before: string; selected: string; after: string }) {
  const rendered = renderedTextPositions(root)
  const index = contextualTextIndex(rendered.text, context.selected, context)
  if (index === undefined) return
  const first = rendered.positions.get(index)
  const last = rendered.positions.get(index + context.selected.length)
  if (!first || !last) return
  const range = document.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset)
  return range
}

function renderedTextPositions(root: HTMLElement) {
  const positions = new Map<number, { node: Text; offset: number }>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ""
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement
    const ignored = parent?.closest(
      '[data-slot="markdown-copy-button"], [data-component="response-annotation-reference"], [aria-hidden="true"]',
    )
    if (!ignored) {
      for (let offset = 0; offset <= node.data.length; offset++) {
        positions.set(text.length + offset, { node, offset })
      }
      text += node.data
    }
    current = walker.nextNode()
  }
  return { text, positions }
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
