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
  const html = createSessionHtml(data, {
    assets: { css: "", runtime: "", markdown: "export const marked = {}" },
    language: "zh-CN",
    labels: { loading: "正在加载", failed: "加载失败", javascript: "请启用 JavaScript" },
  })
  const page = new DOMParser().parseFromString(html, "text/html")
  expect(JSON.parse(page.querySelector("#session-data")!.textContent!)).toEqual(data)
  expect(JSON.parse(page.querySelector("#export-metadata")!.textContent!).product).toBe("CodeAgent")
  expect(page.title).toBe(data.info.title)
  expect(page.querySelector("#injected")).toBeNull()
  expect(page.querySelector("img")).toBeNull()
  expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain(
    "connect-src 'none'",
  )
})
