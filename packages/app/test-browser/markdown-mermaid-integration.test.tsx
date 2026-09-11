import { afterEach, describe, expect, spyOn, test } from "bun:test"
import {
  MarkdownMermaidMounts,
  mountCompletedMarkdownMermaid,
  mountStreamingMarkdownMermaid,
  type MermaidLabels,
} from "@opencode-ai/session-ui/markdown-mermaid-mounts"

const labels: MermaidLabels = {
  diagram: "Mermaid diagram",
  copySource: "Copy Mermaid source",
  copied: "Copied",
  failed: "Unable to render Mermaid diagram",
}

afterEach(() => {
  document.body.replaceChildren()
})

function codeBlock(language: string, source: string) {
  const host = document.createElement("div")
  host.dataset.markdownBlock = ""
  const wrapper = document.createElement("div")
  wrapper.dataset.component = "markdown-code"
  const pre = document.createElement("pre")
  const code = document.createElement("code")
  code.className = `language-${language}`
  code.textContent = source
  pre.append(code)
  wrapper.append(pre)
  host.append(wrapper)
  return { host, wrapper }
}

describe("Markdown Mermaid projection integration", () => {
  test("leaves an incomplete streaming Mermaid fence as ordinary markdown-code", () => {
    // Removing the complete guard in the streaming projection branch would invoke Mermaid while tokens are arriving.
    const mounts = new MarkdownMermaidMounts()
    const mountSpy = spyOn(mounts, "mount").mockImplementation(() => {})
    const { host } = codeBlock("mermaid", "flowchart LR\nA-->B")

    expect(
      mountStreamingMarkdownMermaid(mounts, {
        host,
        source: "flowchart LR\nA-->B",
        language: "mermaid",
        complete: false,
        fenceClosed: false,
        theme: "light",
        labels,
      }),
    ).toBe(false)
    expect(host.querySelector('[data-component="markdown-code"] code')?.textContent).toBe("flowchart LR\nA-->B")
    expect(mountSpy).toHaveBeenCalledTimes(0)
  })

  test("mounts one completed streaming Mermaid fence with exact source and active theme", () => {
    // Omitting the completed streaming code branch would leave a closed Mermaid fence as ordinary source.
    const mounts = new MarkdownMermaidMounts()
    const calls: Parameters<MarkdownMermaidMounts["mount"]>[0][] = []
    spyOn(mounts, "mount").mockImplementation((input) => void calls.push(input))
    const exact = "flowchart LR\r\n  A-->B  \n"
    const { host } = codeBlock("Mermaid", exact)

    expect(
      mountStreamingMarkdownMermaid(mounts, {
        host,
        source: exact,
        language: "Mermaid",
        complete: true,
        fenceClosed: true,
        theme: "dark",
        labels,
      }),
    ).toBe(true)
    expect(calls.map(({ source, theme }) => ({ source, theme }))).toEqual([{ source: exact, theme: "dark" }])
  })

  test("discovers completed Mermaid fences in sanitized full HTML before ordinary decoration", () => {
    // Skipping the full-HTML discovery branch would never hand pre > code.language-mermaid to the mount service.
    const root = document.createElement("div")
    root.innerHTML = [
      '<pre><code class="language-mermaid">sequenceDiagram\nAlice-&gt;&gt;Bob: Hi</code></pre>',
      '<pre><code class="language-typescript">const value = 1</code></pre>',
    ].join("")
    const mounts = new MarkdownMermaidMounts()
    const calls: Parameters<MarkdownMermaidMounts["mount"]>[0][] = []
    spyOn(mounts, "mount").mockImplementation((input) => void calls.push(input))

    const count = mountCompletedMarkdownMermaid(mounts, {
      root,
      markdown: `\`\`\`mermaid\nsequenceDiagram\nAlice->>Bob: Hi\n\`\`\`\n\n    const value = 1`,
      theme: "light",
      labels,
      prepare(pre) {
        const wrapper = document.createElement("div")
        wrapper.dataset.component = "markdown-code"
        pre.replaceWith(wrapper)
        wrapper.append(pre)
        return wrapper
      },
    })

    expect(count).toBe(1)
    expect(calls.map(({ source, theme }) => ({ source, theme }))).toEqual([
      { source: "sequenceDiagram\nAlice->>Bob: Hi", theme: "light" },
    ])
  })

  test("discovers a completed Mermaid fence when the production highlighter omits the code language class", () => {
    const root = document.createElement("div")
    root.innerHTML = "<pre><code>flowchart LR\nA--&gt;B</code></pre>"
    const mounts = new MarkdownMermaidMounts()
    const calls: string[] = []
    spyOn(mounts, "mount").mockImplementation((input) => void calls.push(input.source))

    const count = mountCompletedMarkdownMermaid(mounts, {
      root,
      markdown: "```mermaid\nflowchart LR\nA-->B\n```",
      theme: "light",
      labels,
      prepare(pre) {
        const wrapper = document.createElement("div")
        wrapper.dataset.component = "markdown-code"
        pre.replaceWith(wrapper)
        wrapper.append(pre)
        return wrapper
      },
    })

    expect(count).toBe(1)
    expect(calls).toEqual(["flowchart LR\nA-->B"])
  })

  test("does not discover an unclosed Mermaid fence in first-load sanitized HTML", () => {
    // Trusting Marked's language-mermaid HTML alone would render a fence whose closing delimiter never arrived.
    const root = document.createElement("div")
    root.innerHTML = '<pre><code class="language-mermaid">flowchart LR\nA--&gt;B</code></pre>'
    const mounts = new MarkdownMermaidMounts()
    const mountSpy = spyOn(mounts, "mount").mockImplementation(() => {})

    const count = mountCompletedMarkdownMermaid(mounts, {
      root,
      markdown: "```mermaid\nflowchart LR\nA-->B",
      theme: "light",
      labels,
      prepare: () => {
        throw new Error("an unclosed fence must not be prepared")
      },
    })

    expect(count).toBe(0)
    expect(mountSpy).toHaveBeenCalledTimes(0)
  })

  test("maps indented, nested, and consecutive code blocks without misclassifying them", () => {
    // Matching DOM code nodes without the original Markdown token order would shift after indented or nested blocks.
    const markdown = [
      "    ordinary indented code",
      "",
      "> ```mermaid",
      "> flowchart LR",
      "> A-->B",
      "> ```",
      "",
      "```typescript mermaid",
      "const value = 1",
      "```",
      "```mermaid",
      "sequenceDiagram",
      "Alice->>Bob: Hi",
      "```",
    ].join("\n")
    const root = document.createElement("div")
    root.innerHTML = [
      "<pre><code>ordinary indented code</code></pre>",
      '<blockquote><pre><code class="language-mermaid">flowchart LR\nA--&gt;B</code></pre></blockquote>',
      '<pre><code class="language-typescript">const value = 1</code></pre>',
      '<pre><code class="language-mermaid">sequenceDiagram\nAlice-&gt;&gt;Bob: Hi</code></pre>',
    ].join("")
    const mounts = new MarkdownMermaidMounts()
    const calls: string[] = []
    spyOn(mounts, "mount").mockImplementation((input) => void calls.push(input.source))

    const count = mountCompletedMarkdownMermaid(mounts, {
      root,
      markdown,
      theme: "light",
      labels,
      prepare(pre) {
        const wrapper = document.createElement("div")
        wrapper.dataset.component = "markdown-code"
        pre.replaceWith(wrapper)
        wrapper.append(pre)
        return wrapper
      },
    })

    expect(count).toBe(2)
    expect(calls).toEqual(["flowchart LR\nA-->B", "sequenceDiagram\nAlice->>Bob: Hi"])
  })

  test("keeps typescript mermaid metadata as ordinary code", () => {
    // Looking for mermaid anywhere after the first info-string word would misclassify TypeScript as a diagram.
    const mounts = new MarkdownMermaidMounts()
    const mountSpy = spyOn(mounts, "mount").mockImplementation(() => {})
    const { host } = codeBlock("typescript", "const value = 1")

    expect(
      mountStreamingMarkdownMermaid(mounts, {
        host,
        source: "const value = 1",
        language: "typescript mermaid",
        complete: true,
        fenceClosed: true,
        theme: "light",
        labels,
      }),
    ).toBe(false)
    expect(mountSpy).toHaveBeenCalledTimes(0)
    expect(host.querySelector("code")?.textContent).toBe("const value = 1")
  })
})
