import { test, expect, type Browser } from "@playwright/test"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSessionHtml } from "../../src/utils/session-html"
import { sessionHtmlLabels } from "../../src/utils/session-html-labels"
import { mermaidSourceKey } from "@opencode-ai/session-ui/markdown-mermaid"
import type { SessionExportData } from "../../src/utils/session-export"
import type { SessionHtmlMermaidSnapshot } from "../../src/utils/session-html-mermaid"
import { sessionExportChinese } from "../../src/i18n/session-export"

let launch: Browser
let directory: string
let mermaidRenderer: string
const execFileAsync = promisify(execFile)
const evidence = (name: string) => path.resolve(process.cwd(), "../..", ".xcode", name)
const fixture = {
  info: { id: "ses_export", title: "会话导出示例", time: { created: 1789000000000 } },
  messages: [
    {
      info: { id: "msg_user", role: "user", time: { created: 1789000000000 } },
      parts: [
        { type: "text", text: "请说明 HTML 导出方案。\n需要支持离线阅读。" },
        {
          type: "file",
          filename: "设计.png",
          mime: "image/png",
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPd8AAAAASUVORK5CYII=",
        },
        { type: "file", filename: "本地文档.txt", mime: "text/plain", url: "file:///private/document.txt" },
      ],
    },
    {
      info: { id: "msg_assistant", role: "assistant", parentID: "msg_user", time: { created: 1789000001000 } },
      parts: [
        { type: "reasoning", text: "先检查数据结构，再确定离线渲染方式。" },
        {
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { path: "README.md" }, output: "# 项目说明", title: "读取文件" },
        },
        {
          type: "text",
          text: "## 实现方案\n\n将 **JSON** 和渲染器一起保存。\n\n| 内容 | 方式 |\n| --- | --- |\n| 消息 | 内嵌 JSON |\n\n```js\nconst answer = '<script>safe</script>'\n```\n\n[文档](https://example.com/docs)",
        },
      ],
    },
  ],
} as SessionExportData

test.beforeAll(async ({ browser }) => {
  directory = await mkdtemp(path.join(tmpdir(), "session-html-"))
  launch = browser
  const entrypoint = fileURLToPath(new URL("./session-html-mermaid-browser.ts", import.meta.url))
  const output = path.join(directory, "session-html-mermaid-browser.js")
  await execFileAsync("bun", ["build", entrypoint, "--target=browser", "--format=iife", `--outfile=${output}`])
  mermaidRenderer = await readFile(output, "utf8")
})

test.afterAll(async () => {
  if (
    directory &&
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith("session-html-")
  )
    await rm(directory, { recursive: true, force: true })
})

async function open(data: SessionExportData, width = 1280, mermaid: SessionHtmlMermaidSnapshot[] = []) {
  const runtime = new URL("../../src/utils/session-html/runtime.js", import.meta.url)
  const css = new URL("../../src/utils/session-html/style.css", import.meta.url)
  const html = createSessionHtml(data, {
    assets: {
      runtime: await readFile(runtime, "utf8"),
      css: await readFile(css, "utf8"),
      markdown: await readFile(fileURLToPath(import.meta.resolve("marked")), "utf8"),
    },
    labels: sessionHtmlLabels((key) => sessionExportChinese[key]),
    language: "zh-CN",
    mermaid,
  })
  const file = path.join(directory, `${crypto.randomUUID()}.html`)
  await writeFile(file, html)
  const context = await launch.newContext({ offline: true, viewport: { width, height: 900 } })
  const page = await context.newPage()
  const requests: string[] = []
  const errors: string[] = []
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(pathToFileURL(file).href)
  return { page, context, requests, errors, file }
}

async function renderMermaidSnapshots(data: SessionExportData) {
  const context = await launch.newContext({ offline: true })
  const page = await context.newPage()
  const requests: string[] = []
  const errors: string[] = []
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.addScriptTag({ content: mermaidRenderer })
    const snapshots = await page.evaluate(async (input) => {
      const render = Reflect.get(window, "sessionHtmlMermaidSnapshots") as (
        data: SessionExportData,
      ) => Promise<SessionHtmlMermaidSnapshot[]>
      return render(input)
    }, data)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
    return snapshots
  } finally {
    await context.close()
  }
}

test("offline Mermaid snapshots render diagrams, copy exact source and keep failed source", async ({}, testInfo) => {
  const valid = "flowchart LR\n  accTitle: Export standard\n  Start --> Done\n"
  const wide = [
    "flowchart LR",
    "  accTitle: Export wide",
    ...Array.from(
      { length: 14 },
      (_, index) => `  Node${index}[Step ${index + 1}] --> Node${index + 1}[Step ${index + 2}]`,
    ),
  ].join("\n")
  const invalid = "not a diagram\n"
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    {
      type: "text",
      text: `开始。\n\n\`\`\`mermaid\n${valid}\`\`\`\n\n中间。\n\n\`\`\`mermaid\n${wide}\n\`\`\`\n\n\`\`\`mermaid\n${invalid}\`\`\`\n\n\`\`\`ts\nconst ordinary = true\n\`\`\`\n\n结束。`,
    },
  ] as SessionExportData["messages"][number]["parts"]
  const snapshots = await renderMermaidSnapshots(data)
  const { page, context, requests, errors } = await open(data, 1280, snapshots)
  try {
    const diagrams = page.getByRole("figure", { name: /^Export (standard|wide)$/ })
    await expect(diagrams).toHaveCount(2)
    const diagram = page.getByRole("figure", { name: "Export standard", exact: true })
    const wideDiagram = page.getByRole("figure", { name: "Export wide", exact: true })
    await expect(diagram.locator(":scope > .mermaid-canvas > svg")).toBeVisible()
    await expect(wideDiagram.locator(":scope > .mermaid-canvas > svg")).toBeVisible()
    await expect(diagram.locator("code")).toHaveCount(0)
    await expect(page.locator(".mermaid-failed").filter({ hasText: "图表渲染失败" })).toBeVisible()
    await expect(page.locator("code").filter({ hasText: "not a diagram" })).toBeVisible()
    await expect(page.locator("code").filter({ hasText: "const ordinary = true" })).toBeVisible()
    await expect(page.getByText("开始。", { exact: true })).toBeVisible()
    await expect(page.getByText("中间。", { exact: true })).toBeVisible()
    await expect(page.getByText("结束。", { exact: true })).toBeVisible()

    const layout = async () =>
      page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(".mermaid-card"))
        const wideCanvas = document
          .querySelector<HTMLElement>('[aria-label="Export wide"]')
          ?.querySelector<HTMLElement>(".mermaid-canvas")
        const standardCanvas = document
          .querySelector<HTMLElement>('[aria-label="Export standard"]')
          ?.querySelector<HTMLElement>(".mermaid-canvas")
        const wideSvg = wideCanvas?.querySelector<SVGSVGElement>("svg")
        const labelHeights = Array.from(
          wideSvg?.querySelectorAll("text") ?? [],
          (label) => label.getBoundingClientRect().height,
        ).filter((height) => height > 0)
        return {
          viewport: window.innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          cards: cards.map((card) => {
            const rect = card.getBoundingClientRect()
            return { left: rect.left, right: rect.right, width: rect.width }
          }),
          wideClientWidth: wideCanvas?.clientWidth ?? 0,
          wideScrollWidth: wideCanvas?.scrollWidth ?? 0,
          wideSvgWidth: wideSvg?.getBoundingClientRect().width ?? 0,
          minLabelHeight: labelHeights.length ? Math.min(...labelHeights) : 0,
          standardClientWidth: standardCanvas?.clientWidth ?? 0,
          standardScrollWidth: standardCanvas?.scrollWidth ?? 0,
        }
      })
    const desktop = await layout()
    expect(desktop.pageWidth).toBeLessThanOrEqual(desktop.viewport)
    expect(desktop.cards).toHaveLength(2)
    for (const card of desktop.cards) {
      expect(card.left).toBeGreaterThanOrEqual(0)
      expect(card.right).toBeLessThanOrEqual(desktop.viewport)
    }
    expect(desktop.wideScrollWidth).toBeGreaterThan(desktop.wideClientWidth)
    expect(desktop.wideSvgWidth).toBeGreaterThanOrEqual(1_200)
    expect(desktop.minLabelHeight).toBeGreaterThanOrEqual(10)
    expect(desktop.standardScrollWidth).toBeLessThanOrEqual(desktop.standardClientWidth)

    const zoomIn = wideDiagram.getByRole("button", { name: "放大", exact: true })
    const zoomOut = wideDiagram.getByRole("button", { name: "缩小", exact: true })
    const resetZoom = wideDiagram.getByRole("button", { name: "重置缩放 (100%)", exact: true })
    await zoomIn.click()
    await expect(wideDiagram.getByRole("button", { name: "重置缩放 (125%)", exact: true })).toHaveText("125%")
    const zoomedWidth = await wideDiagram
      .locator(":scope > .mermaid-canvas > svg")
      .evaluate((svg) => svg.getBoundingClientRect().width)
    expect(zoomedWidth).toBeGreaterThan(desktop.wideSvgWidth)

    const canvas = wideDiagram.locator(":scope > .mermaid-canvas")
    await canvas.evaluate((node) => {
      node.scrollLeft = 0
      node.scrollTop = 0
    })
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 30, box.y + box.height / 2)
      await page.mouse.up()
    }
    expect(await canvas.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)

    await wideDiagram.getByRole("button", { name: "重置缩放 (125%)", exact: true }).click()
    await expect(resetZoom).toHaveText("100%")
    expect(await canvas.evaluate((node) => node.scrollLeft)).toBe(0)
    await expect(zoomOut).toBeEnabled()
    await page.screenshot({ path: evidence("mermaid-export-desktop.png"), fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(diagrams).toHaveCount(2)
    await expect(diagram.locator(":scope > .mermaid-canvas > svg")).toBeVisible()
    await expect(wideDiagram.locator(":scope > .mermaid-canvas > svg")).toBeVisible()
    const mobile = await layout()
    expect(mobile.pageWidth).toBeLessThanOrEqual(mobile.viewport)
    expect(mobile.cards).toHaveLength(2)
    for (const card of mobile.cards) {
      expect(card.left).toBeGreaterThanOrEqual(0)
      expect(card.right).toBeLessThanOrEqual(mobile.viewport)
    }
    expect(mobile.wideScrollWidth).toBeGreaterThan(mobile.wideClientWidth)
    expect(mobile.wideSvgWidth).toBeGreaterThanOrEqual(1_200)
    expect(mobile.minLabelHeight).toBeGreaterThanOrEqual(10)
    expect(mobile.standardScrollWidth).toBeLessThanOrEqual(mobile.standardClientWidth)
    await writeFile(testInfo.outputPath("mermaid-export-layout.json"), JSON.stringify({ desktop, mobile }, null, 2))
    await page.screenshot({ path: evidence("mermaid-export-mobile.png"), fullPage: true })
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            Reflect.set(window, "copiedMermaid", text)
            return Promise.resolve()
          },
        },
      }),
    )
    await diagram.getByRole("button", { name: "复制 Mermaid 原文", exact: true }).click()
    expect(await page.evaluate(() => Reflect.get(window, "copiedMermaid"))).toBe(valid)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("offline Mermaid falls back for equal-key wrong-source, missing and invalid SVG snapshots", async () => {
  const collision = "flowchart LR\nAp4zqpkjupw-->B\n"
  const wrongSource = "flowchart LR\nAbuxw36x8ji-->B\n"
  const missing = "flowchart LR\nMissing-->Snapshot\n"
  const invalidSvg = "flowchart LR\nInvalid-->Svg\n"
  expect(mermaidSourceKey(collision)).toBe(mermaidSourceKey(wrongSource))
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    {
      type: "text",
      text: [collision, missing, invalidSvg].map((source) => `\`\`\`mermaid\n${source}\`\`\``).join("\n\n"),
    },
  ] as SessionExportData["messages"][number]["parts"]
  const generated = await renderMermaidSnapshots(data)
  const snapshots = generated.flatMap((snapshot) => {
    if (snapshot.source === collision) return [{ ...snapshot, source: wrongSource }]
    if (snapshot.source === missing) return []
    if (snapshot.source === invalidSvg)
      return [{ ...snapshot, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>' }]
    return [snapshot]
  })
  const { page, context, requests, errors } = await open(data, 1280, snapshots)
  try {
    await expect(page.locator(".mermaid-card")).toHaveCount(0)
    await expect(page.locator(".mermaid-failed")).toHaveCount(3)
    for (const source of ["Ap4zqpkjupw-->B", "Missing-->Snapshot", "Invalid-->Svg"])
      await expect(page.locator("code").filter({ hasText: source })).toBeVisible()
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("offline Mermaid renders only closed fences when an identical snapshot exists", async () => {
  const source = "flowchart LR\n  A --> B\n"
  const closed = `\`\`\`mermaid\n${source}\`\`\``
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    { type: "text", text: `${closed}\n\n${closed}\n\n\`\`\`mermaid\n${source}` },
  ] as SessionExportData["messages"][number]["parts"]
  const snapshots = await renderMermaidSnapshots(data)
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0]?.svg).toContain("<svg")
  const { page, context, requests, errors } = await open(data, 1280, snapshots)
  try {
    await expect(page.locator(".mermaid-card")).toHaveCount(2)
    await expect(page.locator(".code-block code").filter({ hasText: "A --> B" })).toHaveCount(1)
    await expect(page.locator(".mermaid-failed")).toHaveCount(0)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("offline Mermaid namespaces every repeated diagram and keeps references local", async () => {
  const source = "flowchart LR\n  A --> B\n"
  const block = `\`\`\`mermaid\n${source}\`\`\``
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    { type: "text", text: `${block}\n\n${block}` },
  ] as SessionExportData["messages"][number]["parts"]
  const snapshots = await renderMermaidSnapshots(data)
  expect(snapshots).toHaveLength(1)
  const { page, context, requests, errors } = await open(data, 1280, snapshots)
  try {
    await expect(page.locator(".mermaid-card")).toHaveCount(2)
    const references = await page.evaluate(() => {
      const ariaSingle = new Set(["aria-activedescendant", "aria-errormessage"])
      const ariaLists = new Set([
        "aria-controls",
        "aria-describedby",
        "aria-details",
        "aria-flowto",
        "aria-labelledby",
        "aria-owns",
      ])
      const diagrams = Array.from(document.querySelectorAll<SVGSVGElement>(".mermaid-card > .mermaid-canvas > svg"))
      const documentIDs = Array.from(document.querySelectorAll<HTMLElement>("[id]"), (node) => node.id)
      const keyframes: string[] = []
      const invalid: string[] = []
      for (const svg of diagrams) {
        const local = new Set(Array.from(svg.querySelectorAll<SVGElement>("[id]"), (node) => node.id))
        if (svg.id) local.add(svg.id)
        const localKeyframes = new Set<string>()
        for (const style of svg.querySelectorAll("style")) {
          const css = style.textContent || ""
          for (const match of css.matchAll(/@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)) {
            localKeyframes.add(match[1])
            keyframes.push(match[1])
          }
          for (const match of css.matchAll(/#([A-Za-z_][A-Za-z0-9_.:-]*)/g))
            if (match[1].startsWith("mermaid-") && !local.has(match[1])) invalid.push(`selector:${match[1]}`)
          for (const match of css.matchAll(/animation(?:-name)?\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)/g))
            if (!localKeyframes.has(match[1])) invalid.push(`animation:${match[1]}`)
        }
        for (const node of [svg, ...svg.querySelectorAll("*")]) {
          for (const attribute of node.attributes) {
            const name = attribute.name.toLowerCase()
            const value = attribute.value
            if (name === "href" || name === "xlink:href") {
              if (!value.startsWith("#") || !local.has(value.slice(1))) invalid.push(`${name}:${value}`)
            }
            for (const match of value.matchAll(/url\s*\(\s*["']?#([A-Za-z_][A-Za-z0-9_.:-]*)["']?\s*\)/g))
              if (!local.has(match[1])) invalid.push(`url:${match[1]}`)
            if (ariaSingle.has(name) && !local.has(value)) invalid.push(`${name}:${value}`)
            if (ariaLists.has(name))
              for (const id of value.split(/\s+/)) if (id && !local.has(id)) invalid.push(`${name}:${id}`)
          }
        }
      }
      return {
        diagrams: diagrams.length,
        duplicateIDs: documentIDs.filter((id, index) => documentIDs.indexOf(id) !== index),
        duplicateKeyframes: keyframes.filter((name, index) => keyframes.indexOf(name) !== index),
        invalid,
      }
    })
    expect(references).toEqual({ diagrams: 2, duplicateIDs: [], duplicateKeyframes: [], invalid: [] })
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("offline file renders messages, Markdown, collapsed processes and attachments", async ({}, testInfo) => {
  const { page, context, requests, errors, file } = await open(fixture)
  try {
    await expect(page.getByRole("heading", { name: "会话导出示例", exact: true })).toBeVisible()
    await expect(page.getByText("CodeAgent / 会话记录", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "实现方案", exact: true })).toBeVisible()
    await expect(page.getByRole("table")).toContainText("内嵌 JSON")
    await expect(page.getByRole("img", { name: "设计.png" })).toBeVisible()
    await expect(page.getByText("本地文档.txt", { exact: true })).toBeVisible()
    await writeFile(testInfo.outputPath("conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true })
    await expect(page.getByText("先检查数据结构，再确定离线渲染方式。", { exact: true })).toBeHidden()
    await page.getByText("推理记录", { exact: true }).click()
    await expect(page.getByText("先检查数据结构，再确定离线渲染方式。", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "复制代码", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText("已复制")
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "下载原始 JSON" }).click()
    const saved = await download
    expect(JSON.parse(await readFile((await saved.path())!, "utf8"))).toEqual(fixture)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("one reply groups its reasoning, tools and final answer without changing JSON", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  data.messages = [
    data.messages[0],
    ...data.messages[1].parts.map((part, index) => ({
      info: { ...data.messages[1].info, id: `msg_step_${index}`, time: { created: 1789000001000 + index * 2000 } },
      parts: [part],
    })),
  ]
  const { page, context, file, errors } = await open(data)
  try {
    await expect(page.getByRole("heading", { name: "实现方案", exact: true })).toBeVisible()
    await expect(page.getByRole("article")).toHaveCount(2)
    const reply = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "实现方案" }) })
    await expect(reply.locator(".message-meta")).toHaveCount(1)
    await expect(reply.locator("time")).toHaveText(new Date(1789000001000).toLocaleString("zh-CN"))
    await expect(reply.locator(".message-body > *")).toHaveCount(3)
    await expect(reply.locator("summary")).toHaveText(["推理记录", "read · 读取文件已完成"])
    await reply.getByText("推理记录", { exact: true }).click()
    await expect(reply.getByText("先检查数据结构，再确定离线渲染方式。", { exact: true })).toBeVisible()
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "下载原始 JSON" }).click()
    expect(JSON.parse(await readFile((await (await download).path())!, "utf8"))).toEqual(data)
    await writeFile(testInfo.outputPath("grouped-conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("grouped-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("grouped-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("reply grouping follows parent IDs across render batches and interleaved turns", async () => {
  const data = structuredClone(fixture)
  data.messages = [
    data.messages[0],
    ...Array.from({ length: 42 }, (_, index) => ({
      info: { ...data.messages[1].info, id: `msg_step_${index}` },
      parts: [{ ...data.messages[0].parts[0], text: `步骤 ${index + 1}` }],
    })),
    {
      info: { ...data.messages[0].info, id: "msg_second" },
      parts: [{ ...data.messages[0].parts[0], text: "第二个问题" }],
    },
    {
      info: { ...data.messages[1].info, id: "msg_second_reply", parentID: "msg_second" },
      parts: [{ ...data.messages[0].parts[0], text: "第二轮答复" }],
    },
    {
      info: {
        ...data.messages[1].info,
        id: "msg_late",
        error: { name: "UnknownError", data: { message: "第一轮错误" } },
      },
      parts: [{ ...data.messages[0].parts[0], text: "第一轮补充" }],
    },
  ] as SessionExportData["messages"]
  const { page, context, errors } = await open(data)
  try {
    await expect(page.getByText("第一轮补充", { exact: true })).toBeVisible()
    await expect(page.getByRole("article")).toHaveCount(4)
    const first = page.getByRole("article").filter({ has: page.getByText("步骤 1", { exact: true }) })
    await expect(first.locator(".message-body > *")).toHaveText([
      ...Array.from({ length: 42 }, (_, index) => `步骤 ${index + 1}`),
      "第一轮补充",
      "第一轮错误",
    ])
    const second = page.getByRole("article").filter({ has: page.getByText("第二轮答复", { exact: true }) })
    await expect(second.locator(".message-body")).toHaveText("第二轮答复")
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("assistant records without a parent ID remain separate", async () => {
  const data = structuredClone(fixture)
  data.messages = [
    { info: { id: "msg_orphan_1", role: "assistant" }, parts: [{ type: "text", text: "独立记录一" }] },
    { info: { id: "msg_orphan_2", role: "assistant" }, parts: [{ type: "text", text: "独立记录二" }] },
  ] as SessionExportData["messages"]
  const { page, context } = await open(data)
  try {
    await expect(page.getByRole("article")).toHaveCount(2)
    await expect(page.getByRole("article")).toHaveText(["助手独立记录一", "助手独立记录二"])
  } finally {
    await context.close()
  }
})

test("skill triggers render as independent expanded cards outside ordinary tool groups", async () => {
  const data = structuredClone(fixture)
  const skills = ["customize-opencode", "test-driven-development", "verification-before-completion"]
  data.messages[1].parts = [
    ...skills.map((name) => ({
      type: "tool" as const,
      tool: "skill",
      state: {
        status: "completed" as const,
        input: { name },
        output: `Loaded skill: ${name}`,
        title: `Loaded skill: ${name}`,
      },
    })),
    {
      type: "tool",
      tool: "read",
      state: { status: "completed", input: { path: "README.md" }, output: "read output" },
    },
    {
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { command: "bun test" }, output: "test output" },
    },
  ] as SessionExportData["messages"][number]["parts"]

  const { page, context, errors } = await open(data)
  try {
    const cards = page.locator(".skill-card")
    await expect(cards).toHaveCount(3)
    for (const name of skills) {
      const card = page.getByRole("region", { name: `Loaded skill: ${name}`, exact: true })
      await expect(card).toBeVisible()
      await expect(card).toContainText("技能")
      await expect(card).toContainText("已完成")
      await expect(card).toContainText(name)
      await expect(card.locator("summary")).toHaveCount(0)
    }
    expect(await cards.first().evaluate((card) => getComputedStyle(card).borderLeftColor)).toBe("rgb(10, 89, 247)")
    const ordinary = page.locator(".tool-group")
    await expect(ordinary).toHaveCount(1)
    await expect(ordinary.locator(":scope > summary")).toHaveText("工具调用 · 2 个已完成")
    await expect(ordinary).not.toContainText("Loaded skill")
    await page.screenshot({ path: evidence("skill-cards-export.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(cards).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("consecutive ordinary tools collapse into groups across batches and stop at special content", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  const tool = (name: string, status: "completed" | "running" | "error", output?: string) => ({
    type: "tool" as const,
    tool: name,
    state: {
      status,
      input: { name },
      ...(output === undefined ? {} : { output }),
      ...(status === "error" ? { error: `${name} failed` } : {}),
    },
  })
  const assistant = (id: string, parts: SessionExportData["messages"][number]["parts"]) => ({
    info: { ...data.messages[1].info, id },
    parts,
  })
  data.messages = [
    data.messages[0],
    ...Array.from({ length: 38 }, (_, index) =>
      assistant(`msg_preamble_${index}`, [{ type: "text", text: `准备 ${index + 1}` }]),
    ),
    assistant("msg_read", [tool("read", "completed", "read output")]),
    assistant("msg_glob", [tool("glob", "running")]),
    assistant("msg_bash", [tool("bash", "error")]),
    assistant("msg_task", [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "分析模块", prompt: "检查模块", subagent_type: "explore" },
        },
      },
    ]),
    assistant("msg_grep", [tool("grep", "completed", "grep output")]),
    assistant("msg_question", [
      {
        type: "tool",
        tool: "question",
        state: {
          status: "completed",
          input: { questions: [{ question: "继续吗？", options: [] }] },
          metadata: { answers: [["继续"]] },
        },
      },
    ]),
    assistant("msg_list", [tool("list", "completed", "list output")]),
    assistant("msg_boundary", [{ type: "text", text: "接着修改" }]),
    assistant("msg_edit", [tool("edit", "completed", "edit output")]),
    assistant("msg_write", [tool("write", "completed", "write output")]),
  ] as SessionExportData["messages"]

  const { page, context, errors } = await open(data)
  try {
    const failedGroup = page.locator("summary").filter({ hasText: "工具调用 · 3 个" })
    const completedGroup = page.locator("summary").filter({ hasText: "工具调用 · 2 个" })
    await expect(failedGroup).toHaveText("工具调用 · 3 个失败")
    await expect(completedGroup).toHaveText("工具调用 · 2 个已完成")
    await expect(page.getByText("read output", { exact: true })).toBeHidden()
    await failedGroup.click()
    const read = page.locator("summary").filter({ hasText: /^read/ })
    await expect(read).toHaveText("read已完成")
    await expect(page.locator("summary").filter({ hasText: /^glob/ })).toHaveText("glob导出时执行中")
    await expect(page.locator("summary").filter({ hasText: /^bash/ })).toHaveText("bash失败")
    await expect(page.getByText("read output", { exact: true })).toBeHidden()
    await read.click()
    await expect(page.getByText("read output", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "分析模块", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "继续吗？", exact: true })).toBeVisible()
    await expect(page.locator("summary").filter({ hasText: /^grep/ })).toHaveCount(1)
    await expect(page.locator("summary").filter({ hasText: /^list/ })).toHaveCount(1)
    await completedGroup.click()
    await expect(page.locator("summary").filter({ hasText: /^edit/ })).toBeVisible()
    await expect(page.locator("summary").filter({ hasText: /^write/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("tool-groups-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("tool-groups-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("annotation-only prompts show selected text and comments with linked assistant references", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  data.messages = [
    {
      info: data.messages[0].info,
      parts: [
        {
          type: "text",
          text: "",
          metadata: {
            bluedcodeResponseAnnotations: {
              version: 1,
              annotations: [
                {
                  index: 1,
                  source: {
                    messageID: "msg_source",
                    partID: "part_source",
                    start: 0,
                    end: 23,
                    digest: "sha256:fixture",
                  },
                  context: { before: "模块包括：", selected: "singleagent / multiagent", after: "。" },
                  comment: "深入分析这两个模块。",
                },
              ],
            },
          },
        },
      ],
    },
    {
      info: data.messages[1].info,
      parts: [{ type: "text", text: '🔎 :bluedcode-annotation{index="1"}先深入看 singleagent / multiagent 模块。' }],
    },
  ] as SessionExportData["messages"]
  const { page, context, requests, errors, file } = await open(data)
  try {
    await expect(page.getByText("深入分析这两个模块。", { exact: true })).toBeVisible()
    await expect(page.getByText("singleagent / multiagent", { exact: true })).toBeVisible()
    const reference = page.getByRole("link", { name: "注释 1", exact: true })
    await expect(reference).toBeVisible()
    await expect(page.getByRole("article")).toHaveCount(2)
    await expect(page.getByRole("article").filter({ has: reference })).not.toContainText(":bluedcode-annotation")
    await reference.click()
    await expect(page.locator(":target")).toContainText("深入分析这两个模块。")
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "下载原始 JSON" }).click()
    expect(JSON.parse(await readFile((await (await download).path())!, "utf8"))).toEqual(data)
    await writeFile(testInfo.outputPath("annotation-conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("annotation-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("annotation-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("annotation references respect turn boundaries and keep protected or unknown markers literal", async () => {
  const data = structuredClone(fixture)
  const marker = ':bluedcode-annotation{index="1"}'
  data.messages = [0, 1].flatMap((index) => [
    {
      info: { ...fixture.messages[0].info, id: `user_${index}` },
      parts: [
        {
          type: "text",
          text: `问题 ${index}`,
          metadata: {
            bluedcodeResponseAnnotations: {
              version: 1,
              annotations: [
                {
                  index: 1,
                  source: {
                    messageID: "msg_source",
                    partID: "part_source",
                    start: 0,
                    end: 2,
                    digest: "sha256:fixture",
                  },
                  context: { before: "", selected: `<img src=x onerror=alert(1)>原文 ${index}`, after: "" },
                  comment: `评论 ${index} <script>alert(1)</script>`,
                },
              ],
            },
          },
        },
      ],
    },
    {
      info: { ...fixture.messages[1].info, id: `assistant_${index}`, parentID: `user_${index}` },
      parts: [
        {
          type: "text",
          text: `\`${marker}\`\n\n\`\`\`txt\n${marker}\n\`\`\`\n\n> ${marker}\n\n[${marker}](https://example.com)\n\n<div>${marker}</div>\n\n🔎 ${marker} 答复 ${index}\n\n:bluedcode-annotation{index="2"}`,
        },
      ],
    },
  ]) as SessionExportData["messages"]
  const { page, context, errors, requests } = await open(data)
  try {
    await expect(page.getByRole("link", { name: "注释 1", exact: true })).toHaveCount(2)
    for (const index of [0, 1]) {
      const reply = page
        .getByRole("article")
        .filter({ has: page.getByText(`🔎 注释 1 答复 ${index}`, { exact: true }) })
      await expect(reply.locator("pre")).toContainText(marker)
      await expect(reply.locator("blockquote")).toContainText(marker)
      await expect(reply).toContainText(':bluedcode-annotation{index="2"}')
      await reply.getByRole("link", { name: "注释 1", exact: true }).click()
      await expect(page.locator(":target")).toContainText(`评论 ${index} <script>alert(1)</script>`)
    }
    await expect(page.locator("main script, main [onerror]")).toHaveCount(0)
    expect(errors).toEqual([])
    expect(requests).toEqual([])
  } finally {
    await context.close()
  }
})

test("question tools show questions, options and recorded answers without opening raw data", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    {
      type: "tool",
      tool: "question",
      state: {
        status: "completed",
        title: "Asked 2 questions",
        input: {
          questions: [
            {
              header: "下一步做什么",
              question: "接下来需要完成什么？",
              multiple: true,
              options: [
                { label: "修复工具挂载", description: "接入工具管理器。" },
                { label: "补全群组实现", description: "实现子类和事件路由。" },
                { label: "补充文档", description: "整理使用说明。" },
              ],
            },
            { header: "补充说明", question: "有什么额外要求？", options: [] },
          ],
        },
        metadata: { answers: [["修复工具挂载", "补全群组实现"], ["请保留 <script> 示例，支持中文。"]] },
        output: "完整原始工具返回值",
      },
    },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, errors, file } = await open(data)
  try {
    await expect(page.getByRole("heading", { name: "接下来需要完成什么？", exact: true })).toBeVisible()
    await expect(page.getByText("接入工具管理器。", { exact: true })).toBeVisible()
    await expect(page.getByText("请保留 <script> 示例，支持中文。", { exact: true })).toBeVisible()
    const answer = page
      .getByRole("article")
      .filter({ has: page.getByText("请保留 <script> 示例，支持中文。", { exact: true }) })
    await expect(answer.locator(".message-meta > span")).toHaveText("用户")
    await expect(answer.getByRole("heading", { name: "接下来需要完成什么？", exact: true })).toBeVisible()
    await expect(answer.locator(".question-option")).toHaveCount(3)
    await expect(page.locator(".assistant .question-tool")).toHaveCount(0)
    await expect(answer.locator(".question-answer")).toContainText(["修复工具挂载", "请保留 <script> 示例，支持中文。"])
    await expect(page.getByRole("article")).toHaveCount(2)
    await expect(page.locator(".question-option.selected")).toHaveCount(2)
    await expect(page.locator(".question-option.selected")).toContainText(["修复工具挂载", "补全群组实现"])
    await expect(page.getByText("完整原始工具返回值", { exact: true })).toBeHidden()
    await writeFile(testInfo.outputPath("question-conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("question-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("question-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByText("原始输入与输出", { exact: true }).click()
    await expect(page.getByText("完整原始工具返回值", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    await expect(page.locator("main script")).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("question snapshots distinguish waiting, empty answers, missing records and errors", async () => {
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    {
      type: "tool",
      tool: "question",
      state: { status: "running", input: { questions: [{ question: "等待回答的问题", options: [] }] } },
    },
    {
      type: "tool",
      tool: "question",
      state: {
        status: "completed",
        input: { questions: [{ question: "用户未填写的问题", options: [] }] },
        metadata: { answers: [[]] },
        output: "Unanswered",
      },
    },
    {
      type: "tool",
      tool: "question",
      state: {
        status: "completed",
        input: { questions: [{ question: "没有答案记录的问题", options: [] }] },
        metadata: {},
        output: "legacy output",
      },
    },
    {
      type: "tool",
      tool: "question",
      state: {
        status: "error",
        input: { questions: [{ question: "已取消的问题", options: [] }] },
        error: "用户取消了提问",
      },
    },
    {
      type: "tool",
      tool: "question",
      state: { status: "completed", input: { questions: "invalid" }, output: "保留原始异常数据" },
    },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, errors } = await open(data)
  try {
    const card = (question: string) =>
      page.locator(".question-card").filter({ has: page.getByRole("heading", { name: question, exact: true }) })
    await expect(card("等待回答的问题")).toContainText("导出时尚未回答")
    const emptyAnswer = page.getByRole("article").filter({ has: page.getByText("（无答案）", { exact: true }) })
    await expect(emptyAnswer.locator(".message-meta > span")).toHaveText("用户")
    await expect(emptyAnswer).toContainText("用户未填写的问题")
    await expect(card("没有答案记录的问题")).toContainText("未记录答案")
    await expect(page.getByText("用户取消了提问", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(page.getByText("保留原始异常数据", { exact: true })).toBeAttached()
    await expect(page.locator(".question-card input, .question-card button")).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("recorded question answers split assistant continuations within a message and across batches", async () => {
  const data = structuredClone(fixture)
  const question = (text: string, answer: string) => ({
    type: "tool",
    tool: "question",
    state: {
      status: "completed",
      input: { questions: [{ question: text, options: [] }] },
      metadata: { answers: [[answer]] },
      output: "raw answer",
      time: { start: 1789000001500, end: 1789000002000 },
    },
  })
  data.messages = [
    data.messages[0],
    {
      info: data.messages[1].info,
      parts: [
        { type: "text", text: "提问前的说明" },
        question("先选方向？", "先修复"),
        { type: "text", text: "按选择开始处理" },
      ],
    },
    ...Array.from({ length: 39 }, (_, index) => ({
      info: { ...data.messages[1].info, id: `continued_${index}` },
      parts: [{ type: "text", text: `继续处理 ${index}` }],
    })),
    { info: { ...data.messages[1].info, id: "ask_again" }, parts: [question("是否补充文档？", "需要文档")] },
    { info: { ...data.messages[0].info, id: "other_user" }, parts: [{ type: "text", text: "另一轮提问" }] },
    {
      info: { ...data.messages[1].info, id: "other_reply", parentID: "other_user" },
      parts: [{ type: "text", text: "另一轮答复" }],
    },
    { info: { ...data.messages[1].info, id: "final" }, parts: [{ type: "text", text: "文档已补充" }] },
  ] as SessionExportData["messages"]
  const { page, context, errors } = await open(data)
  try {
    await expect(page.getByText("文档已补充", { exact: true })).toBeVisible()
    await expect(page.getByRole("article").locator(".message-meta > span")).toHaveText([
      "用户",
      "助手",
      "用户",
      "助手",
      "用户",
      "助手",
      "用户",
      "助手",
    ])
    const before = page.getByRole("article").filter({ has: page.getByText("提问前的说明", { exact: true }) })
    await expect(before).not.toContainText("先选方向？")
    await expect(before).not.toContainText("按选择开始处理")
    const middle = page.getByRole("article").filter({ has: page.getByText("按选择开始处理", { exact: true }) })
    await expect(middle).toContainText("继续处理 38")
    await expect(middle).not.toContainText("是否补充文档？")
    await expect(middle).not.toContainText("文档已补充")
    await expect(middle.locator("time")).toHaveText(new Date(1789000002000).toLocaleString("zh-CN"))
    const response = page.getByRole("article").filter({ has: page.getByText("先修复", { exact: true }) })
    await expect(response).toContainText("先选方向？")
    await expect(response).toHaveClass(/user/)
    await expect(response.locator("time")).toHaveText(new Date(1789000002000).toLocaleString("zh-CN"))
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("subagents have visible task cards with delegation, results and accurate snapshot states", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    ...fixture.messages[1].parts,
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: {
          description: "分析智能体模块",
          subagent_type: "explore",
          prompt: "检查 singleagent 与 multiagent 模块。",
        },
        metadata: { sessionId: "ses_child" },
        output:
          '<task id="ses_child" state="completed">\n<task_result>\n## 分析结论\n\n模块分工 **明确**。\n\n```js\nconst ready = true\n```\n</task_result>\n</task>',
      },
    },
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "后台检查", subagent_type: "general", prompt: "检查剩余模块。", background: true },
        metadata: { background: true },
        output:
          '<task id="ses_background" state="running">\n<summary>Background task started</summary>\n<task_result>\nStill working\n</task_result>\n</task>',
      },
    },
    {
      type: "tool",
      tool: "task",
      state: { status: "error", input: { description: "失败任务" }, error: "模型调用失败" },
    },
    { type: "tool", tool: "task", state: { status: "pending", input: { description: "等待任务" } } },
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "恶意文本", subagent_type: "<img onerror=alert(1)>" },
        output: "<script>alert(1)</script>\n\n![追踪](https://example.com/tracker)",
      },
    },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, errors, requests, file } = await open(data)
  try {
    const task = page.getByRole("region", { name: "分析智能体模块", exact: true })
    await expect(task.getByRole("heading", { name: "分析结论" })).toBeHidden()
    await expect(task.getByText("检查 singleagent 与 multiagent 模块。", { exact: true })).toBeHidden()
    await expect(task.getByText("explore", { exact: true })).toBeVisible()
    await expect(task.locator(".state")).toHaveText("已完成")
    await expect(page.getByRole("region", { name: "后台检查", exact: true }).locator(".state")).toHaveText(
      "导出时执行中",
    )
    await expect(page.getByRole("region", { name: "失败任务", exact: true }).locator(".state")).toHaveText("失败")
    await expect(page.getByRole("region", { name: "等待任务", exact: true }).locator(".state")).toHaveText(
      "导出时待执行",
    )
    await expect(page.getByText("# 项目说明", { exact: true })).toBeHidden()
    await expect(task.locator(".process-body pre").filter({ hasText: '<task id="ses_child"' })).toBeHidden()
    await expect(page.locator("main script, main [onerror], main img[src^='http']")).toHaveCount(0)
    await writeFile(testInfo.outputPath("task-conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("task-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("task-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const trigger = task.getByRole("button", { name: "查看任务详情：分析智能体模块", exact: true })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "分析智能体模块", exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: "分析结论", exact: true })).toBeVisible()
    await expect(dialog.getByText("检查 singleagent 与 multiagent 模块。", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeFocused()
    // file:// may deny the async clipboard API. Exercise selection-based copying
    // inside the modal, where the rest of the document is inert.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }))
    await dialog.getByRole("button", { name: "复制代码", exact: true }).click()
    await expect(dialog.getByRole("status")).toHaveText("已复制")
    await dialog.getByText("原始输入与输出", { exact: true }).click()
    await expect(dialog.locator("pre").filter({ hasText: '<task id="ses_child"' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("task-dialog-mobile.png") })
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await expect(dialog).toBeHidden()
    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(2, 2)
    await expect(dialog).toBeHidden()
    await page.getByRole("region", { name: "失败任务", exact: true }).getByRole("button").click()
    const failed = page.getByRole("dialog", { name: "失败任务", exact: true })
    await expect(failed.getByText("模型调用失败", { exact: true }).filter({ visible: true })).toBeVisible()
    await failed.getByRole("button", { name: "关闭", exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("task-dialog-desktop.png") })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    expect(errors).toEqual([])
    expect(requests).toEqual([])
  } finally {
    await context.close()
  }
})

test("long subagent details scroll inside the modal while its close button stays visible", async () => {
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "长任务结果", subagent_type: "explore", prompt: "检查全部模块" },
        output: Array.from({ length: 120 }, (_, index) => `检查项 ${index + 1}：已核对。`).join("\n\n"),
      },
    },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, errors } = await open(data, 390)
  try {
    const trigger = page.getByRole("button", { name: "查看任务详情：长任务结果", exact: true })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "长任务结果", exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByText("检查项 120：已核对。", { exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport()
    expect(
      await dialog
        .locator(".subagent-dialog-body")
        .evaluate((node) => node.scrollHeight > node.clientHeight && node.scrollTop > 0),
    ).toBe(true)
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true)
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await expect(trigger).toBeFocused()
    await expect(page.locator("body")).not.toHaveClass(/modal-open/)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("question boundaries and subagent cards compose into an offline conversation", async ({}, testInfo) => {
  const data = structuredClone(fixture)
  data.info.title = "智能体模块分析与修复"
  data.messages[0].parts = [
    { type: "text", text: "帮我分析 singleagent / multiagent 和 skills 模块，给出下一步建议。" },
  ] as SessionExportData["messages"][number]["parts"]
  data.messages[1].parts = [
    { type: "text", text: "我会分别检查智能体模块和工具接入，再汇总建议。" },
    {
      type: "tool",
      tool: "read",
      state: { status: "completed", input: { path: "src/agent.ts" }, output: "已读取智能体入口" },
    },
    {
      type: "tool",
      tool: "glob",
      state: { status: "completed", input: { pattern: "src/**/*.ts" }, output: "找到 18 个文件" },
    },
    {
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { command: "bun test" }, output: "测试通过" },
    },
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: {
          description: "分析 singleagent / multiagent",
          subagent_type: "explore",
          prompt: "梳理单智能体与群组的调用关系，检查事件路由和会话衔接。",
        },
        output: "单智能体的调用路径完整。群组子类和事件路由仍需补齐，建议先明确会话交接边界。",
      },
    },
    {
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: {
          description: "检查 skills 工具接入",
          subagent_type: "explore",
          prompt: "检查 SkillToolKit 与 AbilityManager 的注册关系。",
        },
        output: "SkillToolKit 的 ToolFunction 尚未完整注册到 AbilityManager，建议优先修复工具挂载。",
      },
    },
    {
      type: "tool",
      tool: "question",
      state: {
        status: "completed",
        time: { start: 1789000005000, end: 1789000020000 },
        input: {
          questions: [
            {
              header: "下一步",
              question: "接下来先做什么？",
              multiple: true,
              options: [
                { label: "修复工具挂载", description: "接通 SkillToolKit 与工具管理器。" },
                { label: "补全群组实现", description: "完善子类、事件路由与会话交接。" },
                { label: "补充文档", description: "整理模块职责和接入说明。" },
              ],
            },
          ],
        },
        metadata: { answers: [["修复工具挂载", "补充文档"]] },
        output: "用户选择：修复工具挂载、补充文档。",
      },
    },
    { type: "text", text: "按你的选择，先修复工具挂载，再补充接入文档。" },
    { type: "reasoning", text: "检查注册入口，确认工具定义与管理器接口匹配。" },
    { type: "text", text: "### 处理结果\n\n工具挂载和接入文档已补齐，群组实现留待后续处理。" },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, file, errors, requests } = await open(data)
  try {
    await expect(page.getByRole("heading", { name: "处理结果", exact: true })).toBeVisible()
    await expect(page.getByRole("article").locator(".message-meta > span")).toHaveText(["用户", "助手", "用户", "助手"])
    const toolGroup = page.locator("summary").filter({ hasText: "工具调用 · 3 个" })
    const reasoning = page.getByText("推理记录", { exact: true })
    await expect(toolGroup).toHaveText("工具调用 · 3 个已完成")
    const cardStyle = (summary: typeof reasoning) =>
      summary.evaluate((node) => {
        const style = getComputedStyle(node.parentElement!)
        return {
          borderRadius: style.borderRadius,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
        }
      })
    const expectedCardStyle = {
      borderRadius: "10px",
      borderTopStyle: "solid",
      borderTopWidth: "1px",
      paddingLeft: "14px",
      paddingRight: "14px",
    }
    expect(await cardStyle(toolGroup)).toEqual(expectedCardStyle)
    expect(await cardStyle(reasoning)).toEqual(expectedCardStyle)
    await reasoning.click()
    await expect(page.getByText("检查注册入口，确认工具定义与管理器接口匹配。", { exact: true })).toBeVisible()
    const reasoningBody = page.locator(".reasoning-card > .process-body")
    expect(
      await reasoningBody.evaluate((node) => {
        const style = getComputedStyle(node)
        const summary = node.previousElementSibling!.getBoundingClientRect()
        const body = node.getBoundingClientRect()
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          leftOffset: body.left - summary.left,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          rightOffset: summary.right - body.right,
        }
      }),
    ).toEqual({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderRadius: "0px",
      borderTopStyle: "solid",
      borderTopWidth: "1px",
      leftOffset: 0,
      paddingLeft: "0px",
      paddingRight: "0px",
      rightOffset: 0,
    })
    await expect(page.getByRole("region", { name: "检查 skills 工具接入", exact: true })).toBeVisible()
    await expect(page.locator(".question-answer")).toContainText("补充文档")
    await writeFile(testInfo.outputPath("cards-conversation.html"), await readFile(file))
    await page.screenshot({ path: testInfo.outputPath("cards-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("cards-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(requests).toEqual([])
  } finally {
    await context.close()
  }
})

test("unrecorded question cards sit on the user side without fabricating an answer", async () => {
  const data = structuredClone(fixture)
  data.messages[1].parts = [
    ...["running", "pending", "completed", "error"].map((status) => ({
      type: "tool",
      tool: "question",
      state: {
        status,
        input: { questions: [{ question: `${status} snapshot`, options: [] }] },
        metadata: { answers: status === "completed" ? [[1]] : [["stale answer"]] },
      },
    })),
    { type: "text", text: "仍在同一段助手输出中" },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, errors } = await open(data)
  try {
    await expect(page.getByText("仍在同一段助手输出中", { exact: true })).toBeVisible()
    await expect(page.getByRole("article").locator(".message-meta > span")).toHaveText([
      "用户",
      "问题",
      "问题",
      "问题",
      "问题",
      "助手",
    ])
    await expect(page.locator(".user .question-tool")).toHaveCount(4)
    await expect(page.locator(".question-answer")).toHaveCount(0)
    await expect(page.getByText("stale answer", { exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("untrusted text cannot execute HTML, navigate dangerous URLs or fetch remote images", async () => {
  const data = structuredClone(fixture)
  data.info.title = "</title><script>globalThis.injected=1</script>"
  data.messages[1].parts = [
    {
      type: "text",
      text: `# 安全示例\n\n<script>globalThis.injected=1</script>\n\n<img src="https://example.com/tracker" onerror="globalThis.injected=1">\n\n[危险](javascript:alert(1)) ![远程图](https://example.com/image.png)\n\n<svg onload="globalThis.injected=1"></svg>\n\n</script><script>globalThis.injected=1</script>`,
    },
  ] as SessionExportData["messages"][number]["parts"]
  const { page, context, requests, errors } = await open(data)
  try {
    await expect(page.getByRole("heading", { name: "安全示例" })).toBeVisible()
    expect(await page.evaluate(() => Reflect.get(window, "injected"))).toBeUndefined()
    await expect(
      page.locator('main script, main svg, main iframe, main [onerror], main a[href^="javascript:"]'),
    ).toHaveCount(0)
    await expect(page.locator('main img[src^="http"]')).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))).toEqual(data)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("empty and long conversations finish rendering without mobile page overflow", async () => {
  const empty = await open({ ...fixture, messages: [] }, 390)
  try {
    await expect(empty.page.getByText("此会话暂无消息。", { exact: true })).toBeVisible()
  } finally {
    await empty.context.close()
  }
  const data = structuredClone(fixture)
  data.messages = Array.from({ length: 160 }, (_, index) => ({
    info: { ...fixture.messages[1].info, id: `msg_${index}` },
    parts: [
      {
        type: "text",
        text: `## 第 ${index + 1} 条\n\n${"长文本".repeat(100)}\n\n\`\`\`txt\n${"code".repeat(200)}\n\`\`\``,
      },
    ],
  })) as SessionExportData["messages"]
  const { page, context, errors } = await open(data, 390)
  try {
    await expect(page.getByRole("heading", { name: "第 160 条", exact: true })).toBeAttached()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
