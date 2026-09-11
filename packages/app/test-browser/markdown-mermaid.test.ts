import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import {
  clearMermaidCache,
  mermaidSourceKey,
  renderMermaid,
  sanitizeMermaidSvg,
} from "@opencode-ai/session-ui/markdown-mermaid"

const safeSvg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" id="diagram" viewBox="0 0 20 20">${body}</svg>`

describe("Mermaid SVG safety boundary", () => {
  test("preserves a local marker reference and extracts an accessible title", () => {
    const result = sanitizeMermaidSvg(
      safeSvg(
        '<title>Safe flow</title><defs><marker id="arrow"><path d="M0 0L10 5L0 10z" /></marker></defs><path marker-end="url(#arrow)" d="M0 0L20 20" />',
      ),
    )

    expect(result?.title).toBe("Safe flow")
    expect(result?.svg).toContain("url(#arrow)")
    expect(result?.svg).toContain("<marker")
  })

  test("rejects missing and duplicate local fragment targets", () => {
    expect(sanitizeMermaidSvg(safeSvg('<path marker-end="url(#host-marker)" d="M0 0" />'))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        safeSvg('<defs><marker id="arrow"/><marker id="arrow"/></defs><path marker-end="url(#arrow)" d="M0 0" />'),
      ),
    ).toBeUndefined()
  })

  test("requires ARIA ID references to resolve exactly once", () => {
    expect(sanitizeMermaidSvg(safeSvg('<g aria-labelledby="missing"><text>node</text></g>'))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(safeSvg('<title id="diagram-title">Flow</title><g aria-labelledby="diagram-title" />'))?.svg,
    ).toContain('aria-labelledby="diagram-title"')
  })

  test("validates every ARIA IDREF and IDREFS attribute inside the SVG", () => {
    for (const attribute of [
      "aria-activedescendant",
      "aria-controls",
      "aria-describedby",
      "aria-details",
      "aria-errormessage",
      "aria-flowto",
      "aria-labelledby",
      "aria-owns",
    ]) {
      expect(sanitizeMermaidSvg(safeSvg(`<g ${attribute}="host-node" />`))).toBeUndefined()
    }

    const valid = sanitizeMermaidSvg(
      safeSvg(
        '<g id="first"/><g id="second"/><g aria-activedescendant="first" aria-errormessage="second" aria-controls="first second" aria-describedby="first second" aria-details="first second" aria-flowto="first second" aria-labelledby="first second" aria-owns="first second"/>',
      ),
    )
    expect(valid?.svg).toContain('aria-controls="first second"')
    expect(sanitizeMermaidSvg(safeSvg('<g id="first"/><g aria-activedescendant="first second"/>'))).toBeUndefined()
  })

  test("rejects forbidden elements instead of silently returning stripped content", () => {
    expect(sanitizeMermaidSvg(safeSvg('<script>alert(1)</script><path d="M0 0" />'))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg("<foreignObject><div>unsafe</div></foreignObject>"))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<a href="#node"><text>interactive</text></a>'))).toBeUndefined()
  })

  test("rejects event handlers and external resource attributes", () => {
    expect(sanitizeMermaidSvg(safeSvg('<path onclick="alert(1)" d="M0 0" />'))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<image href="https://example.com/tracker.png" />'))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<use href="javascript:alert(1)" />'))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.com/"><use href="#local" /></svg>',
      ),
    ).toBeUndefined()
  })

  test("rejects foreign namespaces, XML base aliases, and active SVG animation", () => {
    expect(
      sanitizeMermaidSvg(
        safeSvg('<meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=evil" />'),
      ),
    ).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/XML/1998/namespace" x:base="https://example.com/"><path /></svg>',
      ),
    ).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<animateColor attributeName="fill" to="blue" dur="1s" />'))).toBeUndefined()
  })

  test("fails when DOMPurify would remove content and retains validated local use", () => {
    expect(sanitizeMermaidSvg(safeSvg("<unknown-safe-looking-element />"))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<path unknown-safe-looking-attribute="value" />'))).toBeUndefined()
    const localUse = sanitizeMermaidSvg(
      safeSvg('<defs><g id="local"><path d="M0 0" /></g></defs><use href="#local" />'),
    )
    expect(localUse?.svg).toContain('<use href="#local"')
  })

  test("rejects active or remote CSS while retaining local fragment URLs", () => {
    expect(sanitizeMermaidSvg(safeSvg("<style>@import url('https://example.com/x.css');</style>"))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(safeSvg('<style>.node{fill:url("https://example.com/fill.svg")}</style>')),
    ).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg('<path style="filter:url(data:image/svg+xml,bad)" />'))).toBeUndefined()

    const local = sanitizeMermaidSvg(
      safeSvg(
        '<style>#diagram .edge{marker-end:url(#arrow)}</style><defs><marker id="arrow"><path d="M0 0L10 5L0 10z" /></marker></defs>',
      ),
    )
    expect(local?.svg).toContain("url(#arrow)")
  })

  test("rejects style selectors that can affect the host document", () => {
    expect(sanitizeMermaidSvg(safeSvg("<style>body{display:none}</style>"))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg("<style>#diagram .node,html{display:none}</style>"))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg("<style>#diagram{position:fixed;inset:0}</style>"))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" style="position:fixed;inset:0"><path d="M0 0" /></svg>',
      ),
    ).toBeUndefined()
  })

  test("rejects root-equivalent selectors and overlay declarations on descendants", () => {
    for (const selector of ["#diagram[id]", "#diagram:not(.never)", "#diagram.flowchart"]) {
      const svg = safeSvg(`<style>${selector}{position:fixed;height:100vh;z-index:999}</style>`).replace(
        'id="diagram"',
        'id="diagram" class="flowchart"',
      )
      expect(sanitizeMermaidSvg(svg)).toBeUndefined()
      expect(sanitizeMermaidSvg(safeSvg(`<style>${selector}{fill:red}</style>`))).toBeUndefined()
    }
    expect(
      sanitizeMermaidSvg(
        safeSvg('<style>#diagram .node{position:sticky;height:100vh;z-index:999}</style><g class="node"/>'),
      ),
    ).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg("<style>#diagram .node{position:fixed!important}</style>"))).toBeUndefined()
  })

  test("allows only bounded Mermaid declarations on the SVG root", () => {
    for (const declaration of [
      "scale:100",
      "overflow:visible",
      "box-shadow:0 0 0 99999px red",
      "filter:drop-shadow(0 0 99999px red)",
    ]) {
      expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram{${declaration}}</style>`))).toBeUndefined()
      expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram[id]{${declaration}}</style>`))).toBeUndefined()
    }
    expect(
      sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg" id="diagram" style="max-width:99999px"/>'),
    ).toBeUndefined()

    const trusted = sanitizeMermaidSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" style="max-width:1024px"><style>#diagram{--mermaid-font-family:ui-sans-serif,system-ui,sans-serif;font-family:ui-sans-serif,system-ui,sans-serif;font-size:16px;fill:#333}</style></svg>',
    )
    expect(trusted?.svg).toContain("max-width:1024px")
  })

  test("allows only the measured Mermaid attributes on the SVG root", () => {
    for (const attribute of [
      'transform="scale(100)"',
      'overflow="visible"',
      'opacity="0.01"',
      'pointer-events="none"',
    ]) {
      expect(sanitizeMermaidSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="diagram" ${attribute}/>`)).toBeUndefined()
    }
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" clip-path="url(#clip)"><defs><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs></svg>',
      ),
    ).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" mask="url(#mask)"><defs><mask id="mask"><rect width="10" height="10"/></mask></defs></svg>',
      ),
    ).toBeUndefined()
  })

  test("rejects unbounded root dimensions and view boxes", () => {
    for (const attributes of [
      'width="99999" height="99999"',
      'width="999%"',
      'height="Infinity"',
      'width="1e9"',
      'viewBox="0 0 99999 99999"',
      'viewBox="0 0 NaN 10"',
      'viewBox="0 0 1e9 10"',
    ]) {
      expect(sanitizeMermaidSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="diagram" ${attributes}/>`)).toBeUndefined()
    }
  })

  test("rejects filters on the SVG root even when their target is local", () => {
    expect(
      sanitizeMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" filter="url(#huge)"><defs><filter id="huge" width="150%" height="150%"><feDropShadow dx="2" dy="2" stdDeviation="0" flood-opacity="0.06" flood-color="#000000"/></filter></defs></svg>',
      ),
    ).toBeUndefined()
  })

  test("bounds filter regions and permits only Mermaid drop shadows", () => {
    for (const filter of [
      '<filter id="huge" x="-99999%" width="99999%"><feDropShadow stdDeviation="0"/></filter>',
      '<filter id="huge"><feGaussianBlur stdDeviation="99999"/></filter>',
      '<filter id="huge"><feDropShadow stdDeviation="Infinity"/></filter>',
      '<filter id="huge"><feDropShadow stdDeviation="1e9"/></filter>',
    ]) {
      expect(sanitizeMermaidSvg(safeSvg(`<defs>${filter}</defs>`))).toBeUndefined()
    }
  })

  test("retains scoped Mermaid animation keyframes without allowing other at-rules", () => {
    const svg = safeSvg(
      "<style>@keyframes dash{to{stroke-dashoffset:0}}#diagram .edge{animation:dash 20s linear infinite}</style>",
    )
    expect(sanitizeMermaidSvg(svg)?.svg).toContain("@keyframes dash")
    expect(sanitizeMermaidSvg(safeSvg("<style>@font-face{font-family:x;src:local(x)}</style>"))).toBeUndefined()
  })

  test("rejects image and unknown CSS functions including relative string resources", () => {
    for (const declaration of [
      'background-image:image("evil.png")',
      'background-image:image-set("evil.png" 1x)',
      'background-image:cross-fade(20%, "evil.png", red)',
      "background-image:element(#host-node)",
      "background:paint(untrusted)",
      "filter:var(--host-filter)",
      'background:"evil.png"',
      'cursor:"evil.cur"',
    ]) {
      expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram .node{${declaration}}</style>`))).toBeUndefined()
    }
  })

  test("resolves Mermaid font variables only from one trusted root definition", () => {
    const use = "#diagram .node{font-family:var(--mermaid-font-family)}"
    const trusted = "--mermaid-font-family:ui-sans-serif,system-ui,sans-serif"
    expect(sanitizeMermaidSvg(safeSvg(`<style>${use}</style>`))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram .node{${trusted}}${use}</style>`))).toBeUndefined()
    expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram{${trusted}}${use}</style>`))?.svg).toContain(
      "var(--mermaid-font-family)",
    )
    expect(sanitizeMermaidSvg(safeSvg(`<style>#diagram{${trusted}}#diagram{${trusted}}${use}</style>`))).toBeUndefined()
    expect(
      sanitizeMermaidSvg(safeSvg(`<style>#diagram{--mermaid-font-family:var(--mermaid-font-family)}${use}</style>`)),
    ).toBeUndefined()
    expect(
      sanitizeMermaidSvg(
        safeSvg(
          `<style>#diagram{${trusted}}#diagram .node{font-family:var(--mermaid-font-family,var(--host-font))}</style>`,
        ),
      ),
    ).toBeUndefined()
  })

  test("requires exactly one SVG document root", () => {
    expect(sanitizeMermaidSvg("<div>not svg</div>")).toBeUndefined()
    expect(sanitizeMermaidSvg("<svg></svg><svg></svg>")).toBeUndefined()
    expect(sanitizeMermaidSvg('<!DOCTYPE svg [<!ENTITY x "unsafe">]><svg>&x;</svg>')).toBeUndefined()
  })
})

describe("Mermaid rendering service", () => {
  let restoreInnerHTML: (() => void) | undefined
  let rawMermaidSvg = ""

  beforeAll(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")
    if (!descriptor?.get || !descriptor.set) return
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...descriptor,
      get(this: Element) {
        const value = descriptor.get?.call(this) as string
        if (!this.id.startsWith("dmermaid-") || this.firstElementChild?.localName !== "svg") return value
        const svg = this.firstElementChild.cloneNode(true) as Element
        rawMermaidSvg = svg.outerHTML
        svg.querySelectorAll("style").forEach((style) => style.remove())
        return `<svg xmlns="http://www.w3.org/2000/svg">${svg.outerHTML}</svg>`
      },
    })
    restoreInnerHTML = () => Object.defineProperty(Element.prototype, "innerHTML", descriptor)
  })

  afterAll(() => restoreInnerHTML?.())
  afterEach(() => clearMermaidCache())

  test("renders a real strict flowchart to safe SVG", async () => {
    clearMermaidCache()
    const result = await renderMermaid("flowchart LR\nA-->B", "light")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).toContain("<svg")
    expect(result.svg.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(
      /<script|foreignObject|\son[a-z][\w:-]*\s*=|https?:/i,
    )
    const config = (
      await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")
    ).default.mermaidAPI.getConfig()
    expect(config.securityLevel).toBe("strict")
    expect(config.htmlLabels).toBe(false)
    expect(config.maxTextSize).toBe(50_000)
    expect(config.maxEdges).toBe(500)
    const raw = sanitizeMermaidSvg(rawMermaidSvg)
    expect(raw?.svg).toContain("<style>")
    expect(raw?.svg).toContain("#mermaid-light-18-186bads")
  })

  test("keeps light and dark render cache entries separate", async () => {
    const source = "flowchart LR\nLight-->Dark"
    const light = await renderMermaid(source, "light")
    const dark = await renderMermaid(source, "dark")

    expect(light.ok).toBe(true)
    expect(dark.ok).toBe(true)
    expect(light.key).not.toBe(dark.key)
    if (!light.ok || !dark.ok) return
    expect(light.svg).not.toBe(dark.svg)
  })

  test("returns a uniquely namespaced SVG for concurrent equal-source renders", async () => {
    const source = "flowchart LR\nA-->B"
    const [first, second] = await Promise.all([renderMermaid(source, "light"), renderMermaid(source, "light")])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const firstIDs = svgIDs(first.svg)
    const secondIDs = svgIDs(second.svg)
    expect(firstIDs.size).toBeGreaterThan(0)
    expect([...firstIDs].some((id) => secondIDs.has(id))).toBe(false)
    expectLocalReferencesResolveOnce(first.svg)
    expectLocalReferencesResolveOnce(second.svg)
  })

  test("does not resolve a diagram reference to an existing host ID", async () => {
    const host = document.createElement("div")
    host.id = "mermaid-light-18-186bads_flowchart-v2-pointEnd"
    document.body.append(host)
    try {
      const result = await renderMermaid("flowchart LR\nA-->B", "light")
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(svgIDs(result.svg).has(host.id)).toBe(false)
      expectLocalReferencesResolveOnce(result.svg)
    } finally {
      host.remove()
    }
  })

  test("rewrites cached CSS selectors and ARIA references for every instance", async () => {
    const mermaid = (await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")).default
    const original = mermaid.render
    let calls = 0
    mermaid.render = async () => {
      calls++
      return {
        svg: safeSvg(
          '<style>#diagram{--mermaid-font-family:ui-sans-serif,system-ui,sans-serif}#diagram .node{marker-end:url(#arrow);font-family:var(--mermaid-font-family)}</style><title id="diagram-title">Flow</title><g id="diagram-details"/><defs><marker id="arrow"><path d="M0 0L10 5L0 10z" /></marker></defs><g class="node" aria-activedescendant="diagram-title" aria-controls="diagram-title diagram-details" aria-describedby="diagram-title diagram-details" aria-details="diagram-title diagram-details" aria-errormessage="diagram-details" aria-flowto="diagram-title diagram-details" aria-labelledby="diagram-title diagram-details" aria-owns="diagram-title diagram-details" />',
        ),
      }
    }

    try {
      const source = "flowchart LR\nCache-->Instance"
      const first = await renderMermaid(source, "light")
      const second = await renderMermaid(source, "light")
      expect(calls).toBe(1)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return

      for (const result of [first, second]) {
        const document = svgDocument(result.svg)
        const rootID = document.documentElement.id
        expect(document.querySelector("style")?.textContent).toContain(`#${rootID} .node`)
        const node = document.querySelector(".node")
        for (const attribute of [
          "aria-activedescendant",
          "aria-controls",
          "aria-describedby",
          "aria-details",
          "aria-errormessage",
          "aria-flowto",
          "aria-labelledby",
          "aria-owns",
        ]) {
          for (const target of node?.getAttribute(attribute)?.split(/\s+/) ?? []) {
            expect(document.querySelectorAll(`[id="${target}"]`)).toHaveLength(1)
          }
        }
        expectLocalReferencesResolveOnce(result.svg)
      }
      expect(svgIDs(first.svg)).not.toEqual(svgIDs(second.svg))
    } finally {
      mermaid.render = original
    }
  })

  test("classifies invalid Mermaid syntax without exposing the parser error", async () => {
    const result = await renderMermaid("not-a-diagram\nA-->B", "light")

    expect(result).toEqual({
      ok: false,
      key: expect.any(String),
      source: "not-a-diagram\nA-->B",
      reason: "syntax",
    })
  })

  test("classifies rejected SVG as unsafe and never caches the failure", async () => {
    const mermaid = (await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")).default
    const original = mermaid.render
    let calls = 0
    mermaid.render = async () => {
      calls++
      return { svg: safeSvg("<script>alert(1)</script>") }
    }

    try {
      const source = "flowchart LR\nUnsafe-->Output"
      const first = await renderMermaid(source, "light")
      const second = await renderMermaid(source, "light")
      expect(first.ok ? undefined : first.reason).toBe("unsafe")
      expect(second.ok ? undefined : second.reason).toBe("unsafe")
      expect(calls).toBe(2)
    } finally {
      mermaid.render = original
    }
  })

  test("classifies an unexpected renderer exception as runtime", async () => {
    const mermaid = (await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")).default
    const original = mermaid.render
    mermaid.render = async () => {
      throw new TypeError("unexpected renderer failure")
    }

    try {
      const result = await renderMermaid("flowchart LR\nRuntime-->Failure", "light")
      expect(result.ok ? undefined : result.reason).toBe("runtime")
    } finally {
      mermaid.render = original
    }
  })

  test("rejects text and edge limits as limit failures", async () => {
    const text = await renderMermaid(`flowchart LR\nA[${"x".repeat(50_001)}]`, "light")
    expect(text.ok).toBe(false)
    if (!text.ok) expect(text.reason).toBe("limit")

    const edges = Array.from({ length: 501 }, (_, index) => `N${index}-->N${index + 1}`).join("\n")
    const graph = await renderMermaid(`flowchart LR\n${edges}`, "light")
    expect(graph.ok).toBe(false)
    if (!graph.ok) expect(graph.reason).toBe("limit")
  })

  test("site configuration prevents diagram directives from enabling HTML and CSS", async () => {
    const source = [
      "---",
      "config:",
      "  securityLevel: loose",
      "  htmlLabels: true",
      "  themeCSS: '@import url(https://example.com/unsafe.css);'",
      "---",
      "flowchart LR",
      "A[Safe]-->B[Output]",
    ].join("\n")
    const result = await renderMermaid(source, "light")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.svg).not.toMatch(/foreignObject|@import|https:\/\/example\.com/i)
  })

  test("checks exact source when equal-length sources collide", async () => {
    const first = "flowchart LR\nAbuxw36x8ji-->B"
    const second = "flowchart LR\nAp4zqpkjupw-->B"
    expect(first.length).toBe(second.length)
    expect(mermaidSourceKey(first)).toBe(mermaidSourceKey(second))

    const firstResult = await renderMermaid(first, "light")
    const secondResult = await renderMermaid(second, "light")

    expect(firstResult.ok).toBe(true)
    expect(secondResult.ok).toBe(true)
    if (!secondResult.ok) return
    expect(secondResult.source).toBe(second)
    expect(secondResult.svg).toContain("Ap4zqpkjupw")
    expect(secondResult.svg).not.toContain("Abuxw36x8ji")
    expect(svgRootID(firstResult.ok ? firstResult.svg : "")).not.toBe(svgRootID(secondResult.svg))
    expectLocalReferencesResolveOnce(firstResult.ok ? firstResult.svg : "")
    expectLocalReferencesResolveOnce(secondResult.svg)
  })

  test("serializes configuration and rendering across concurrent themes", async () => {
    const mermaid = (await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")).default
    const original = mermaid.render
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let maximum = 0
    let calls = 0

    mermaid.render = async (id) => {
      calls++
      active++
      maximum = Math.max(maximum, active)
      if (calls === 1) await gate
      active--
      return { svg: safeSvg(`<title>${id}</title><path d="M0 0" />`) }
    }

    try {
      const light = renderMermaid("flowchart LR\nA-->B", "light")
      const dark = renderMermaid("flowchart LR\nC-->D", "dark")
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)
      release()
      expect((await light).ok).toBe(true)
      expect((await dark).ok).toBe(true)
      expect(maximum).toBe(1)
    } finally {
      release()
      mermaid.render = original
    }
  })

  test("uses a 100-entry LRU and refreshes a successful cache hit", async () => {
    const mermaid = (await import("../../session-ui/node_modules/mermaid/dist/mermaid.core.mjs")).default
    const original = mermaid.render
    let calls = 0
    mermaid.render = async (id, source) => {
      calls++
      return { svg: safeSvg(`<title>${id}</title><text>${escapeXmlText(source)}</text>`) }
    }

    try {
      const source = (index: number) => `flowchart LR\nA${index}-->B${index}`
      await renderMermaid(source(0), "light")
      for (let index = 1; index < 100; index++) await renderMermaid(source(index), "light")
      await renderMermaid(source(0), "light")
      await renderMermaid(source(100), "light")
      await renderMermaid(source(0), "light")
      expect(calls).toBe(101)

      await renderMermaid(source(1), "light")
      expect(calls).toBe(102)
    } finally {
      mermaid.render = original
    }
  })
})

function svgDocument(svg: string) {
  return new DOMParser().parseFromString(svg, "image/svg+xml")
}

function svgIDs(svg: string) {
  return new Set(Array.from(svgDocument(svg).querySelectorAll("[id]"), (element) => element.id))
}

function svgRootID(svg: string) {
  return svgDocument(svg).documentElement.id
}

function expectLocalReferencesResolveOnce(svg: string) {
  const document = svgDocument(svg)
  const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id)
  const references = Array.from(
    svg.matchAll(/(?:url\(|(?:href|xlink:href)=\")#([A-Za-z0-9_.:-]+)/g),
    (match) => match[1],
  )
  for (const reference of references) expect(ids.filter((id) => id === reference)).toHaveLength(1)
}

function escapeXmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
