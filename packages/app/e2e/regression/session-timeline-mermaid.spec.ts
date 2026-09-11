import { expect, test, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const screenshot = (name: string) => path.resolve(process.cwd(), "../..", ".xcode", name)

const standardSource = [
  "flowchart LR",
  "  accTitle: Standard flow",
  "  Start([Start]) --> Verify{Verified?}",
  "  Verify -->|Yes| Share([Share])",
  "  Verify -->|No| Start",
].join("\n")

const wideSource = [
  "flowchart LR",
  "  accTitle: Wide flow",
  ...Array.from(
    { length: 14 },
    (_, index) => `  Node${index}[Step ${index + 1}] --> Node${index + 1}[Step ${index + 2}]`,
  ),
].join("\n")

const invalidSource = "flowchart LR\n  Broken --"

function collectExternalRequests(page: Page) {
  const requests: string[] = []
  const allowed = new Set([
    `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
  ])
  page.on("request", (request) => {
    if (!/^https?:/.test(request.url())) return
    const url = new URL(request.url())
    if (!allowed.has(url.origin)) requests.push(request.url())
  })
  return requests
}

async function useLightTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("opencode-color-scheme", "light")
  })
}

test("renders complete Mermaid cards, exact source, fallback and bounded layout in both themes", async ({
  page,
}, testInfo) => {
  const requests = collectExternalRequests(page)
  await useLightTheme(page)
  const markdown = [
    "Paragraph before the diagrams.",
    `\`\`\`mermaid\n${standardSource}\n\`\`\``,
    "Paragraph between the diagrams.",
    `\`\`\`Mermaid title=wide\n${wideSource}\n\`\`\``,
    `\`\`\`mermaid\n${invalidSource}\n\`\`\``,
    "```ts\nconst ordinary = true\n```",
    "Paragraph after the diagrams.",
  ].join("\n\n")

  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_mermaid_complete", markdown)])],
    locale: "en",
    reducedMotion: true,
  })

  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  const diagrams = page.getByRole("figure", { name: /^(Standard|Wide) flow$/ })
  await expect(diagrams).toHaveCount(2)
  const standard = page.getByRole("figure", { name: "Standard flow", exact: true })
  const wide = page.getByRole("figure", { name: "Wide flow", exact: true })
  await expect(standard.locator('[data-slot="markdown-mermaid-diagram"] > svg')).toHaveCount(1)
  await expect(wide.locator('[data-slot="markdown-mermaid-diagram"] > svg')).toHaveCount(1)
  await expect(page.getByText("Paragraph before the diagrams.", { exact: true })).toBeVisible()
  await expect(page.getByText("Paragraph between the diagrams.", { exact: true })).toBeVisible()
  await expect(page.getByText("Paragraph after the diagrams.", { exact: true })).toBeVisible()
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
  await standard.hover()
  const copy = standard.locator('[data-slot="markdown-mermaid-copy-button"]')
  await expect(copy).toHaveAccessibleName("Copy Mermaid source")
  await expect(copy).toBeVisible()
  await copy.click()
  await expect(copy).toHaveAccessibleName("Copied")
  expect(await page.evaluate(() => Reflect.get(window, "copiedMermaid"))).toBe(standardSource)

  const failed = page.locator('[data-component="markdown-code"][data-mermaid-failed="true"]')
  await expect(failed.getByRole("status")).toHaveText("Unable to render Mermaid diagram")
  await expect(failed.locator("code")).toContainText(invalidSource)
  const ordinary = page.locator('[data-component="markdown-code"]').filter({ hasText: "const ordinary = true" })
  await expect(ordinary).toHaveCount(1)
  await expect(ordinary).not.toHaveAttribute("data-mermaid-failed")

  const bounds = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-component="markdown-mermaid"]'))
    const wideCanvas = document
      .querySelector<HTMLElement>('[aria-label="Wide flow"]')
      ?.querySelector<HTMLElement>('[data-slot="markdown-mermaid-diagram"]')
    const standardCanvas = document
      .querySelector<HTMLElement>('[aria-label="Standard flow"]')
      ?.querySelector<HTMLElement>('[data-slot="markdown-mermaid-diagram"]')
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
  expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.cards).toHaveLength(2)
  for (const card of bounds.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0)
    expect(card.right).toBeLessThanOrEqual(bounds.viewport)
    expect(card.width).toBeGreaterThan(100)
  }
  expect(bounds.wideScrollWidth).toBeGreaterThan(bounds.wideClientWidth)
  expect(bounds.wideSvgWidth).toBeGreaterThanOrEqual(1_200)
  expect(bounds.minLabelHeight).toBeGreaterThanOrEqual(10)
  expect(bounds.standardScrollWidth).toBeLessThanOrEqual(bounds.standardClientWidth)

  const zoomIn = wide.locator('[data-slot="markdown-mermaid-zoom-in"]')
  const zoomOut = wide.locator('[data-slot="markdown-mermaid-zoom-out"]')
  const resetZoom = wide.locator('[data-slot="markdown-mermaid-zoom-reset"]')
  await expect(zoomIn).toHaveAccessibleName("Zoom in")
  await expect(zoomOut).toHaveAccessibleName("Zoom out")
  await expect(resetZoom).toHaveAccessibleName("Reset zoom (100%)")
  await zoomIn.click()
  await expect(resetZoom).toHaveAccessibleName("Reset zoom (125%)")
  await expect(resetZoom).toHaveText("125%")
  expect(
    await wide
      .locator('[data-slot="markdown-mermaid-diagram"] > svg')
      .evaluate((svg) => svg.getBoundingClientRect().width),
  ).toBeGreaterThan(bounds.wideSvgWidth)

  const wideCanvas = wide.locator('[data-slot="markdown-mermaid-diagram"]')
  await wideCanvas.evaluate((node) => {
    node.scrollLeft = 0
    node.scrollTop = 0
  })
  const wideBox = await wideCanvas.boundingBox()
  expect(wideBox).not.toBeNull()
  if (wideBox) {
    await page.mouse.move(wideBox.x + wideBox.width - 30, wideBox.y + wideBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(wideBox.x + 30, wideBox.y + wideBox.height / 2)
    await page.mouse.up()
  }
  expect(await wideCanvas.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
  await resetZoom.click()
  await expect(resetZoom).toHaveText("100%")
  expect(await wideCanvas.evaluate((node) => node.scrollLeft)).toBe(0)
  await expect(zoomOut).toBeEnabled()

  const debugTools = page.getByRole("button", { name: "Toggle debug tools", exact: true })
  await expect(debugTools).toHaveAttribute("aria-pressed", "true")
  await debugTools.click()
  await expect(debugTools).toHaveAttribute("aria-pressed", "false")
  await page.getByRole("button", { name: "Dismiss Tabs information", exact: true }).click()
  await expect(
    page.getByLabel("Introducing Tabs. Organize your work and active sessions with tabs", { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText("Failed to list files", { exact: true })).toHaveCount(0)
  await wide.hover()
  await page.screenshot({ path: screenshot("mermaid-app-light.png"), fullPage: true, animations: "disabled" })
  const lightSvg = await standard.locator("svg").evaluate((svg) => svg.outerHTML)
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const scheme = page.locator('[data-action="settings-color-scheme"]')
  await expect(scheme).toContainText("Light")
  await scheme.click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await expect
    .poll(() => standard.locator("svg").evaluate((svg) => svg.outerHTML), { timeout: 30_000 })
    .not.toBe(lightSvg)
  await expect(diagrams).toHaveCount(2)
  await page.screenshot({ path: screenshot("mermaid-app-dark.png"), fullPage: true, animations: "disabled" })
  const darkBounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    cards: Array.from(document.querySelectorAll<HTMLElement>('[data-component="markdown-mermaid"]')).map((card) => {
      const rect = card.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width }
    }),
    wideClientWidth:
      document
        .querySelector<HTMLElement>('[aria-label="Wide flow"]')
        ?.querySelector<HTMLElement>('[data-slot="markdown-mermaid-diagram"]')?.clientWidth ?? 0,
    wideScrollWidth:
      document
        .querySelector<HTMLElement>('[aria-label="Wide flow"]')
        ?.querySelector<HTMLElement>('[data-slot="markdown-mermaid-diagram"]')?.scrollWidth ?? 0,
    wideSvgWidth:
      document
        .querySelector<SVGSVGElement>('[aria-label="Wide flow"] [data-slot="markdown-mermaid-diagram"] > svg')
        ?.getBoundingClientRect().width ?? 0,
  }))
  expect(darkBounds.pageWidth).toBeLessThanOrEqual(darkBounds.viewport)
  expect(darkBounds.wideScrollWidth).toBeGreaterThan(darkBounds.wideClientWidth)
  expect(darkBounds.wideSvgWidth).toBeGreaterThanOrEqual(1_200)
  await writeFile(
    testInfo.outputPath("mermaid-app-layout.json"),
    JSON.stringify({ light: bounds, dark: darkBounds }, null, 2),
  )
  expect(requests).toEqual([])
})

test("keeps an open streaming fence as source and renders only after the closing fence arrives", async ({ page }) => {
  const requests = collectExternalRequests(page)
  await useLightTheme(page)
  const id = "prt_mermaid_streaming"
  const open = `Streaming lead-in.\n\n\`\`\`mermaid\n${standardSource}`
  const closed = `${open}\n\`\`\`\n\nStreaming tail.`
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart(id, open)], { completed: false })],
    locale: "en",
    reducedMotion: true,
  })

  const part = page.locator(`[data-timeline-part-role="assistant"][data-timeline-part-id="${id}"]`)
  await expect(part.locator("code")).toContainText("flowchart LR")
  await expect(page.getByRole("figure", { name: "Standard flow", exact: true })).toHaveCount(0)

  await timeline.send(partUpdated(textPart(id, closed)))
  const diagram = page.locator('[data-component="markdown-mermaid"]')
  await expect(diagram).toHaveCount(1, { timeout: 30_000 })
  await expect(diagram).toHaveAttribute("role", "figure")
  await expect(diagram.locator('[data-slot="markdown-mermaid-diagram"] > svg')).toHaveCount(1)
  await expect(page.getByText("Streaming lead-in.", { exact: true })).toBeVisible()
  await expect(page.getByText("Streaming tail.", { exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test("blocks Mermaid click, HTML labels, frontmatter overrides and external resources", async ({ page }) => {
  const requests = collectExternalRequests(page)
  await useLightTheme(page)
  const hostile = [
    "---",
    "config:",
    "  theme: dark",
    "  htmlLabels: true",
    "  themeCSS: |",
    '    @import url("https://mermaid-hostile.invalid/import.css");',
    '    @font-face { font-family: hostile; src: url("https://mermaid-hostile.invalid/font.woff2"); }',
    '    .node { background-image: url("https://mermaid-hostile.invalid/image.png"); cursor: url("https://mermaid-hostile.invalid/icon.cur"), auto; }',
    "---",
    "flowchart LR",
    "  accTitle: Hostile diagram",
    '  A["<img src=https://mermaid-hostile.invalid/label.png>"] --> B[Safe]',
    '  click A "javascript:alert(1)"',
  ].join("\n")
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_mermaid_hostile", `\`\`\`mermaid\n${hostile}\n\`\`\``)])],
    locale: "en",
    reducedMotion: true,
  })

  const fallback = page.locator('[data-component="text-part"][data-timeline-part-id="prt_mermaid_hostile"]')
  await expect(fallback.getByRole("status")).toHaveText("Unable to render Mermaid diagram")
  await expect(fallback.locator("code")).toContainText(hostile)
  await expect(fallback.locator('[data-slot="markdown-mermaid-diagram"] > svg')).toHaveCount(0)
  expect(requests).toEqual([])
})
