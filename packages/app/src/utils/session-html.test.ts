import { expect, test } from "bun:test"
import { createSessionHtml } from "./session-html"
import type { SessionExportData } from "./session-export"

test("embedded JSON survives HTML delimiters without creating executable elements", () => {
  const data = {
    info: { id: "ses_1", title: '</title><script id="injected">alert(1)</script> 中文' },
    messages: [
      { info: { role: "user" }, parts: [{ type: "text", text: "</script><img src=x onerror=alert(1)>\u2028\u2029" }] },
    ],
  } as SessionExportData
  const mermaid = [
    {
      key: "11.17.2:light:1:test",
      source: "flowchart TD\n  A --> B\n",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><title>Flow</title></svg>',
      title: "Flow",
    },
  ]
  const html = createSessionHtml(data, {
    assets: { css: "", runtime: "", markdown: "export const marked = {}" },
    language: "zh-CN",
    labels: { loading: "正在加载", failed: "加载失败", javascript: "请启用 JavaScript" },
    mermaid,
  })
  const page = new DOMParser().parseFromString(html, "text/html")
  expect(JSON.parse(page.querySelector("#session-data")!.textContent!)).toEqual(data)
  const metadata = JSON.parse(page.querySelector("#export-metadata")!.textContent!)
  expect(metadata.product).toBe("CodeAgent")
  expect(metadata.rendererVersion).toBe(12)
  expect(JSON.parse(page.querySelector("#mermaid-snapshots")!.textContent!)).toEqual({
    formatVersion: 1,
    mermaidVersion: "11.17.2",
    snapshots: mermaid,
  })
  expect(metadata).not.toHaveProperty("mermaid")
  expect(html).not.toContain("mermaid.initialize")
  expect(page.title).toBe(data.info.title)
  expect(page.querySelector("#injected")).toBeNull()
  expect(page.querySelector("img")).toBeNull()
  expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain(
    "connect-src 'none'",
  )
})
