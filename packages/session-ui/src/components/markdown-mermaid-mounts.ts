import { createEffect, createSignal, onCleanup } from "solid-js"
import { render as renderSolid } from "solid-js/web"
import { marked } from "marked"
import { isMermaidLanguage, renderMermaid, type MermaidRenderResult, type MermaidTheme } from "./markdown-mermaid"
import { markdownFenceClosed } from "./markdown-stream"

export type MermaidLabels = {
  diagram: string
  copySource: string
  copied: string
  failed: string
  zoomOut: string
  resetZoom: string
  zoomIn: string
}

type MountInput = {
  host: HTMLElement
  source: string
  theme: MermaidTheme
  labels: MermaidLabels
  render?: typeof renderMermaid
}

type StreamingMountInput = MountInput & {
  language?: string
  complete?: boolean
  fenceClosed?: boolean
}

type CompletedMountInput = Omit<MountInput, "host" | "source"> & {
  root: HTMLElement
  markdown: string
  prepare: (pre: HTMLPreElement) => HTMLElement | undefined
}

type MountState = {
  request: object
  dispose?: VoidFunction
  card?: HTMLElement
  wrapper?: HTMLElement
}

type MarkdownCodeToken = {
  raw: string
  text: string
  lang?: string
}

const svgNamespace = "http://www.w3.org/2000/svg"
const maxSvgWidth = 20_000

export class MarkdownMermaidMounts {
  private states = new WeakMap<HTMLElement, MountState>()
  private hosts = new Set<HTMLElement>()

  mount(input: MountInput) {
    this.release(input.host)
    this.resetFailure(input.host)

    const request = {}
    this.states.set(input.host, { request })
    this.hosts.add(input.host)

    const renderer = input.render ?? renderMermaid
    void renderer(input.source, input.theme)
      .then((result) => this.complete(input, request, result))
      .catch(() => this.fail(input, request))
  }

  clear(root?: Element, afterRestore?: (root: Element) => void) {
    const hosts = root
      ? Array.from(this.hosts).filter((host) => host === root || root.contains(host))
      : Array.from(this.hosts)
    hosts.forEach((host) => this.release(host))
    if (root && afterRestore) afterRestore(root)
  }

  private complete(input: MountInput, request: object, result: MermaidRenderResult) {
    if (!this.matches(input.host, request)) return
    if (!result.ok) {
      this.fail(input, request)
      return
    }
    if (result.source !== input.source) return

    const svg = this.parseSvg(result.svg)
    if (!svg) {
      this.fail(input, request)
      return
    }
    const width = this.sizeSvg(svg)

    const wrapper = this.codeWrapper(input.host)
    if (!wrapper) return

    const card = document.createElement("div")
    card.dataset.component = "markdown-mermaid"
    card.setAttribute("role", "figure")
    card.setAttribute("aria-label", result.title || input.labels.diagram)

    const diagram = document.createElement("div")
    diagram.dataset.slot = "markdown-mermaid-diagram"
    diagram.appendChild(svg)

    const action = document.createElement("div")
    action.dataset.slot = "markdown-mermaid-copy"
    const dispose = mountMermaidActions(action, diagram, svg as SVGSVGElement, width, input.source, input.labels)

    card.append(diagram, action)
    wrapper.replaceWith(card)
    this.states.set(input.host, { request, dispose, card, wrapper })
  }

  private fail(input: MountInput, request: object) {
    if (!this.matches(input.host, request)) return
    const wrapper = this.codeWrapper(input.host)
    if (!wrapper) return
    wrapper.dataset.mermaidFailed = "true"
    const existing = wrapper.querySelector<HTMLElement>('[data-slot="markdown-mermaid-failed"]')
    if (existing) {
      existing.textContent = input.labels.failed
      return
    }
    const status = document.createElement("div")
    status.dataset.slot = "markdown-mermaid-failed"
    status.setAttribute("role", "status")
    status.textContent = input.labels.failed
    wrapper.appendChild(status)
  }

  private matches(host: HTMLElement, request: object) {
    return this.states.get(host)?.request === request
  }

  private parseSvg(source: string): Element | undefined {
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml")
    if (parsed.querySelector("parsererror")) return undefined
    const root = parsed.documentElement
    if (root.namespaceURI !== svgNamespace || root.localName !== "svg") return undefined
    return document.importNode(root, true)
  }

  private sizeSvg(svg: Element) {
    const width = this.intrinsicWidth(svg)
    if (!width) return
    ;(svg as SVGSVGElement).style.width = `${Math.ceil(width)}px`
    return width
  }

  private intrinsicWidth(svg: Element) {
    const viewBox = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
    const viewBoxWidth = viewBox?.length === 4 ? Number(viewBox[2]) : Number.NaN
    if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0 && viewBoxWidth <= maxSvgWidth) return viewBoxWidth
    const width = svg
      .getAttribute("width")
      ?.trim()
      .match(/^(\d+(?:\.\d*)?|\.\d+)(?:px)?$/i)
    const intrinsic = width ? Number(width[1]) : Number.NaN
    if (Number.isFinite(intrinsic) && intrinsic > 0 && intrinsic <= maxSvgWidth) return intrinsic
  }

  private resetFailure(host: HTMLElement) {
    const wrapper = this.codeWrapper(host)
    if (!wrapper) return
    delete wrapper.dataset.mermaidFailed
    wrapper.querySelector('[data-slot="markdown-mermaid-failed"]')?.remove()
  }

  private release(host: HTMLElement) {
    const state = this.states.get(host)
    state?.dispose?.()
    if (state?.card?.parentNode && state.wrapper) state.card.replaceWith(state.wrapper)
    this.resetFailure(host)
    this.states.delete(host)
    this.hosts.delete(host)
  }

  private codeWrapper(host: HTMLElement) {
    if (host.dataset.component === "markdown-code") return host
    return host.querySelector<HTMLElement>('[data-component="markdown-code"]')
  }
}

export function mountStreamingMarkdownMermaid(mounts: MarkdownMermaidMounts, input: StreamingMountInput) {
  if (!input.fenceClosed || !isMermaidLanguage(input.language)) return false
  mounts.mount(input)
  return true
}

export function mountCompletedMarkdownMermaid(mounts: MarkdownMermaidMounts, input: CompletedMountInput) {
  let count = 0
  const blocks = Array.from(input.root.querySelectorAll("pre > code"))
  const tokens: MarkdownCodeToken[] = []
  void marked.walkTokens(marked.lexer(input.markdown), (token) => {
    if (token.type !== "code") return
    tokens.push({ raw: token.raw, text: token.text, lang: token.lang })
  })
  if (blocks.length !== tokens.length) return count

  for (const [index, code] of blocks.entries()) {
    if (!(code instanceof HTMLElement)) continue
    const token = tokens[index]
    if (!token || !markdownFenceClosed(token.raw) || !isMermaidLanguage(token.lang)) continue
    const renderedLanguage = code.className.match(/(?:^|\s)language-([^\s]+)/)?.[1]
    if (renderedLanguage && !isMermaidLanguage(renderedLanguage)) continue
    const pre = code.parentElement
    if (!(pre instanceof HTMLPreElement)) continue
    const wrapper = input.prepare(pre)
    if (!wrapper) continue

    const parent = wrapper.parentElement
    const host =
      parent?.dataset.markdownMermaidHost !== undefined
        ? parent
        : (() => {
            const created = document.createElement("div")
            created.dataset.markdownMermaidHost = ""
            created.style.display = "contents"
            wrapper.replaceWith(created)
            created.appendChild(wrapper)
            return created
          })()
    mounts.mount({
      host,
      source: token.text,
      theme: input.theme,
      labels: input.labels,
      render: input.render,
    })
    count++
  }
  return count
}

function mountMermaidActions(
  host: HTMLElement,
  canvas: HTMLElement,
  svg: SVGSVGElement,
  width: number | undefined,
  source: string,
  labels: MermaidLabels,
) {
  const minimum = 0.5
  const maximum = 2
  const step = 0.25
  let scale = 1

  const zoomOut = document.createElement("button")
  zoomOut.type = "button"
  zoomOut.dataset.slot = "markdown-mermaid-zoom-out"
  zoomOut.setAttribute("aria-label", labels.zoomOut)
  zoomOut.title = labels.zoomOut
  zoomOut.textContent = "−"

  const resetZoom = document.createElement("button")
  resetZoom.type = "button"
  resetZoom.dataset.slot = "markdown-mermaid-zoom-reset"

  const zoomIn = document.createElement("button")
  zoomIn.type = "button"
  zoomIn.dataset.slot = "markdown-mermaid-zoom-in"
  zoomIn.setAttribute("aria-label", labels.zoomIn)
  zoomIn.title = labels.zoomIn
  zoomIn.textContent = "+"

  const update = () => {
    const percentage = `${Math.round(scale * 100)}%`
    svg.style.width = width ? `${Math.ceil(width * scale)}px` : percentage
    svg.style.minWidth = percentage
    svg.style.maxWidth = "none"
    resetZoom.textContent = percentage
    resetZoom.setAttribute("aria-label", `${labels.resetZoom} (${percentage})`)
    resetZoom.title = `${labels.resetZoom} (${percentage})`
    zoomOut.disabled = scale <= minimum
    zoomIn.disabled = scale >= maximum
  }
  const setScale = (next: number) => {
    scale = Math.min(maximum, Math.max(minimum, next))
    update()
  }
  const shrink = () => setScale(scale - step)
  const grow = () => setScale(scale + step)
  const reset = () => {
    setScale(1)
    canvas.scrollLeft = 0
    canvas.scrollTop = 0
  }

  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | undefined
  const startDrag = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.button !== 0) return
    if (canvas.scrollWidth <= canvas.clientWidth && canvas.scrollHeight <= canvas.clientHeight) return
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    }
    canvas.dataset.dragging = "true"
    canvas.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const moveDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    canvas.scrollLeft = drag.left - (event.clientX - drag.x)
    canvas.scrollTop = drag.top - (event.clientY - drag.y)
  }
  const stopDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    drag = undefined
    delete canvas.dataset.dragging
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }

  zoomOut.addEventListener("click", shrink)
  resetZoom.addEventListener("click", reset)
  zoomIn.addEventListener("click", grow)
  canvas.addEventListener("pointerdown", startDrag)
  canvas.addEventListener("pointermove", moveDrag)
  canvas.addEventListener("pointerup", stopDrag)
  canvas.addEventListener("pointercancel", stopDrag)
  canvas.addEventListener("lostpointercapture", stopDrag)
  host.append(zoomOut, resetZoom, zoomIn)
  update()

  const disposeCopy = renderSolid(() => {
    const [copied, setCopied] = createSignal(false)
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.slot = "markdown-mermaid-copy-button"
    let reset: ReturnType<typeof setTimeout> | undefined

    const update = () => {
      const label = copied() ? labels.copied : labels.copySource
      button.setAttribute("aria-label", label)
      button.title = label
      button.dataset.copied = copied() ? "true" : "false"
      button.textContent = label
    }
    createEffect(update)

    const copy = async () => {
      if (!navigator.clipboard) return
      try {
        await navigator.clipboard.writeText(source)
        setCopied(true)
        if (reset) clearTimeout(reset)
        reset = setTimeout(() => setCopied(false), 2000)
      } catch {}
    }
    button.addEventListener("click", copy)
    onCleanup(() => {
      button.removeEventListener("click", copy)
      if (reset) clearTimeout(reset)
    })
    return button
  }, host)

  return () => {
    disposeCopy()
    zoomOut.removeEventListener("click", shrink)
    resetZoom.removeEventListener("click", reset)
    zoomIn.removeEventListener("click", grow)
    canvas.removeEventListener("pointerdown", startDrag)
    canvas.removeEventListener("pointermove", moveDrag)
    canvas.removeEventListener("pointerup", stopDrag)
    canvas.removeEventListener("pointercancel", stopDrag)
    canvas.removeEventListener("lostpointercapture", stopDrag)
  }
}
