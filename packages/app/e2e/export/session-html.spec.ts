import { test, expect, type Browser } from "@playwright/test"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSessionHtml } from "../../src/utils/session-html"
import { sessionHtmlLabels } from "../../src/utils/session-html-labels"
import type { SessionExportData } from "../../src/utils/session-export"
import { sessionExportChinese } from "../../src/i18n/session-export"

let launch: Browser
let directory: string
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
})

test.afterAll(async () => {
  if (
    directory &&
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith("session-html-")
  )
    await rm(directory, { recursive: true, force: true })
})

async function open(data: SessionExportData, width = 1280) {
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
    product: "BluedCode",
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

test("offline file renders messages, Markdown, collapsed processes and attachments", async ({}, testInfo) => {
  const { page, context, requests, errors, file } = await open(fixture)
  try {
    await expect(page.getByRole("heading", { name: "会话导出示例", exact: true })).toBeVisible()
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
