import { describe, expect, test } from "bun:test"
import { isMermaidLanguage, mermaidSourceKey } from "./markdown-mermaid"

describe("Mermaid Markdown contract", () => {
  test("recognizes only mermaid as the first info-string word", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true)
    expect(isMermaidLanguage(" Mermaid title=Flow ")).toBe(true)
    expect(isMermaidLanguage("MERMAID")).toBe(true)
    expect(isMermaidLanguage("typescript mermaid")).toBe(false)
    expect(isMermaidLanguage("mermaidish")).toBe(false)
    expect(isMermaidLanguage(undefined)).toBe(false)
  })

  test("keys include exact UTF-16 length and checksum", () => {
    expect(mermaidSourceKey("flowchart LR\nA-->B")).toMatch(/^18:[a-z0-9]+$/)
    expect(mermaidSourceKey("flowchart LR\nA-->B")).not.toBe(mermaidSourceKey("flowchart LR\nA-->C"))
    expect(mermaidSourceKey("")).toBe("0:0")
  })
})
