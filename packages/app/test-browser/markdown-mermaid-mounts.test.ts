import { afterEach, describe, expect, test } from "bun:test"
import type { MermaidRenderResult, MermaidTheme } from "@opencode-ai/session-ui/markdown-mermaid"
import { MarkdownMermaidMounts, type MermaidLabels } from "@opencode-ai/session-ui/markdown-mermaid-mounts"

const labels: MermaidLabels = {
  diagram: "Mermaid diagram",
  copySource: "Copy Mermaid source",
  copied: "Copied",
  failed: "Unable to render Mermaid diagram",
  zoomOut: "Zoom out",
  resetZoom: "Reset zoom",
  zoomIn: "Zoom in",
}

const source = "flowchart LR\nA-->B"

function codeHost(value = source) {
  const host = document.createElement("div")
  host.dataset.markdownBlock = ""
  const wrapper = document.createElement("div")
  wrapper.dataset.component = "markdown-code"
  const pre = document.createElement("pre")
  const code = document.createElement("code")
  code.className = "language-mermaid"
  code.textContent = value
  pre.appendChild(code)
  wrapper.appendChild(pre)
  host.appendChild(wrapper)
  document.body.appendChild(host)
  return host
}

function success(value = source): MermaidRenderResult {
  return {
    ok: true,
    key: `${value.length}:safe`,
    source: value,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Flow</title><path d="M0 0L20 20" /></svg>',
    title: "Flow",
  }
}

function successWithoutTitle(value = source): MermaidRenderResult {
  return {
    ok: true,
    key: `${value.length}:safe-no-title`,
    source: value,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0L20 20" /></svg>',
  }
}

function failure(value = source): MermaidRenderResult {
  return { ok: false, key: `${value.length}:bad`, source: value, reason: "syntax" }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("Markdown Mermaid mount lifecycle", () => {
  test("keeps the complete ordinary code block until the matching safe diagram is ready", async () => {
    // Removing the pending-state guard would make this fail by hiding source before a safe SVG exists.
    const host = codeHost()
    const pending = deferred<MermaidRenderResult>()
    const mounts = new MarkdownMermaidMounts()

    mounts.mount({ host, source, theme: "light", labels, render: () => pending.promise })
    expect(host.querySelector('[data-component="markdown-code"] pre code')?.textContent).toBe(source)
    expect(host.querySelector('[data-component="markdown-mermaid"]')).toBeNull()

    pending.resolve(success())
    await pending.promise
    await settle()

    expect(host.querySelector('[data-component="markdown-code"]')).toBeNull()
    const card = host.querySelector('[data-component="markdown-mermaid"]')
    expect(card?.querySelector("svg")).not.toBeNull()
    expect(card?.getAttribute("aria-label")).toBe("Flow")
  })

  test("uses the localized diagram name when a safe render has no title", async () => {
    // Leaving an untitled SVG unnamed would make the successful figure inaccessible.
    const host = codeHost()
    const mounts = new MarkdownMermaidMounts()
    mounts.mount({ host, source, theme: "light", labels, render: async () => successWithoutTitle() })
    await settle()

    expect(host.querySelector('[data-component="markdown-mermaid"]')?.getAttribute("aria-label")).toBe(labels.diagram)
  })

  test("ignores late results after the source or theme request changes", async () => {
    // Applying render promises without request identity would let the stale light diagram replace the dark result.
    const host = codeHost()
    const first = deferred<MermaidRenderResult>()
    const second = deferred<MermaidRenderResult>()
    const calls: Array<{ source: string; theme: MermaidTheme }> = []
    const mounts = new MarkdownMermaidMounts()
    const render = (value: string, theme: MermaidTheme) => {
      calls.push({ source: value, theme })
      return calls.length === 1 ? first.promise : second.promise
    }

    mounts.mount({ host, source, theme: "light", labels, render })
    mounts.mount({ host, source, theme: "dark", labels, render })
    first.resolve(success())
    await first.promise
    await settle()
    expect(host.querySelector('[data-component="markdown-mermaid"]')).toBeNull()

    second.resolve(success())
    await second.promise
    await settle()
    expect(host.querySelectorAll('[data-component="markdown-mermaid"]')).toHaveLength(1)
    expect(calls).toEqual([
      { source, theme: "light" },
      { source, theme: "dark" },
    ])
  })

  test("keeps the full ordinary code block and adds a localized status when rendering fails", async () => {
    // Replacing failures with an empty card would make this lose the original code and failure explanation.
    const host = codeHost()
    const mounts = new MarkdownMermaidMounts()

    mounts.mount({ host, source, theme: "light", labels, render: async () => failure() })
    await settle()

    const wrapper = host.querySelector<HTMLElement>('[data-component="markdown-code"]')
    expect(wrapper?.dataset.mermaidFailed).toBe("true")
    expect(wrapper?.querySelector("code")?.textContent).toBe(source)
    expect(wrapper?.querySelector('[data-slot="markdown-mermaid-failed"]')?.textContent).toBe(labels.failed)
    expect(host.querySelector('[data-component="markdown-mermaid"]')).toBeNull()
  })

  test("copies the exact fence-interior source without exposing it in a successful card", async () => {
    // Reading rendered SVG text or normalized code from the DOM would make this fail for exact source copy.
    const exact = "flowchart LR\r\n  A-->|x|B  \n"
    const copied: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void copied.push(value) },
    })
    const host = codeHost(exact)
    const mounts = new MarkdownMermaidMounts()

    mounts.mount({ host, source: exact, theme: "light", labels, render: async () => success(exact) })
    await settle()

    const card = host.querySelector<HTMLElement>('[data-component="markdown-mermaid"]')
    expect(card?.textContent).not.toContain(exact)
    const button = card?.querySelector<HTMLButtonElement>(`button[aria-label="${labels.copySource}"]`)
    expect(button).not.toBeNull()
    button?.click()
    await settle()
    expect(copied).toEqual([exact])
    expect(button?.getAttribute("aria-label")).toBe(labels.copied)
  })

  test("zooms each diagram independently and resets its viewport", async () => {
    const first = codeHost()
    const second = codeHost("flowchart LR\nC-->D")
    const mounts = new MarkdownMermaidMounts()
    mounts.mount({ host: first, source, theme: "light", labels, render: async () => success() })
    mounts.mount({
      host: second,
      source: "flowchart LR\nC-->D",
      theme: "light",
      labels,
      render: async () => success("flowchart LR\nC-->D"),
    })
    await settle()

    const card = first.querySelector<HTMLElement>('[data-component="markdown-mermaid"]')
    const other = second.querySelector<HTMLElement>('[data-component="markdown-mermaid"]')
    const svg = card?.querySelector<SVGSVGElement>("svg")
    const canvas = card?.querySelector<HTMLElement>('[data-slot="markdown-mermaid-diagram"]')
    const zoomIn = card?.querySelector<HTMLButtonElement>('[data-slot="markdown-mermaid-zoom-in"]')
    const zoomOut = card?.querySelector<HTMLButtonElement>('[data-slot="markdown-mermaid-zoom-out"]')
    const reset = card?.querySelector<HTMLButtonElement>('[data-slot="markdown-mermaid-zoom-reset"]')

    expect(zoomIn?.getAttribute("aria-label")).toBe(labels.zoomIn)
    expect(zoomOut?.getAttribute("aria-label")).toBe(labels.zoomOut)
    expect(reset?.getAttribute("aria-label")).toBe(`${labels.resetZoom} (100%)`)
    zoomIn?.click()
    expect(svg?.style.width).toBe("25px")
    expect(reset?.textContent).toBe("125%")
    expect(other?.querySelector<SVGSVGElement>("svg")?.style.width).toBe("20px")

    if (canvas) {
      canvas.scrollLeft = 12
      canvas.scrollTop = 8
    }
    reset?.click()
    expect(svg?.style.width).toBe("20px")
    expect(reset?.textContent).toBe("100%")
    expect(canvas?.scrollLeft).toBe(0)
    expect(canvas?.scrollTop).toBe(0)

    for (let index = 0; index < 2; index++) zoomOut?.click()
    expect(svg?.style.width).toBe("10px")
    expect(zoomOut?.disabled).toBe(true)
    for (let index = 0; index < 6; index++) zoomIn?.click()
    expect(svg?.style.width).toBe("40px")
    expect(zoomIn?.disabled).toBe(true)
  })

  test("clear invalidates pending work and disposes mounted actions under the supplied root", async () => {
    // Forgetting request invalidation or Solid disposal would let removed Markdown blocks update after cleanup.
    const host = codeHost()
    const pending = deferred<MermaidRenderResult>()
    const mounts = new MarkdownMermaidMounts()
    mounts.mount({ host, source, theme: "light", labels, render: () => pending.promise })

    mounts.clear(host)
    pending.resolve(success())
    await pending.promise
    await settle()
    expect(host.querySelector('[data-component="markdown-code"]')).not.toBeNull()
    expect(host.querySelector('[data-component="markdown-mermaid"]')).toBeNull()

    mounts.mount({ host, source, theme: "light", labels, render: async () => success() })
    await settle()
    expect(host.querySelector("button")).not.toBeNull()
    mounts.clear(host)
    expect(host.querySelector("button")).toBeNull()
    expect(host.querySelector('[data-component="markdown-code"] code')?.textContent).toBe(source)
  })

  test("clear removes a failed-render marker before the block is reused as ordinary code", async () => {
    // Leaving failure UI attached during cleanup would leak Mermaid state when a streaming block changes language.
    const host = codeHost()
    const mounts = new MarkdownMermaidMounts()
    mounts.mount({ host, source, theme: "light", labels, render: async () => failure() })
    await settle()
    expect(host.querySelector('[data-mermaid-failed="true"]')).not.toBeNull()

    mounts.clear(host)
    expect(host.querySelector("[data-mermaid-failed]")).toBeNull()
    expect(host.querySelector('[data-slot="markdown-mermaid-failed"]')).toBeNull()
  })

  test("restores a hidden ordinary copy root before its owner is disposed", async () => {
    // Disposing only the visible Mermaid card would leak the Solid root stored in the detached code wrapper.
    const host = codeHost()
    const ordinaryCopyRoot = document.createElement("div")
    ordinaryCopyRoot.dataset.slot = "markdown-copy-button"
    host.querySelector('[data-component="markdown-code"]')?.append(ordinaryCopyRoot)
    const mounts = new MarkdownMermaidMounts()
    mounts.mount({ host, source, theme: "light", labels, render: async () => success() })
    await settle()
    expect(host.contains(ordinaryCopyRoot)).toBe(false)

    let disposed = 0
    mounts.clear(host, (restored) => {
      expect(restored.contains(ordinaryCopyRoot)).toBe(true)
      disposed++
    })
    expect(disposed).toBe(1)
  })
})
