import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

for (const layout of ["v1", "v2"] as const) {
  test(`exports full JSON and offline HTML from the ${layout} session menu`, async ({ page, browser }, testInfo) => {
    const messages = fixture.messages[fixture.targetID]
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      directory: fixture.directory,
      project: fixture.project,
      provider: fixture.provider,
      pageMessages: () => ({ items: messages.slice(-6) }),
    })
    // The real legacy API returns all messages when limit is omitted. The shared
    // timeline mock defaults to a page, so model this export contract explicitly.
    await page.route(`**/session/${fixture.targetID}/message*`, async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has("limit")) return route.fallback()
      await route.fulfill({ json: messages })
    })
    await page.addInitScript((layout) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: layout === "v2" } }))
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
    }, layout)
    await installStressSessionTabs(page, { sessionIDs: [fixture.targetID] })
    await page.goto(stressSessionHref(fixture.targetID))
    await expectSessionTitle(page, fixture.expected.targetTitle)
    if (layout === "v2") await page.getByRole("button", { name: "Dismiss Tabs information", exact: true }).click()
    await page.getByRole("button", { name: "More options", exact: true }).click()
    const htmlDownload = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: /^Export HTML/ }).click()
    const html = await htmlDownload
    expect(html.suggestedFilename()).toMatch(/\.html$/)
    const saved = testInfo.outputPath("exported-conversation.html")
    await html.saveAs(saved)

    const offline = await browser.newContext({ offline: true })
    try {
      const viewer = await offline.newPage()
      await viewer.goto(pathToFileURL(saved).href)
      await expect(viewer.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
      const embedded = await viewer.evaluate(() => JSON.parse(document.getElementById("session-data")!.textContent!))
      expect(embedded.messages).toEqual(messages)
      await expect(viewer.getByRole("article")).toHaveCount(messages.length)
    } finally {
      await offline.close()
    }

    await page.getByRole("button", { name: "More options", exact: true }).click()
    const jsonDownload = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: /^Export(?:\.\.\.)?$/ }).click()
    const json = await jsonDownload
    expect(json.suggestedFilename()).toMatch(/\.json$/)
    expect(JSON.parse(await readFile((await json.path())!, "utf8")).messages).toEqual(messages)

    await page.keyboard.press("Control+Shift+P")
    await page.getByPlaceholder("Search files, commands, and sessions", { exact: true }).fill("Export HTML")
    const commandDownload = page.waitForEvent("download")
    await page.getByRole("dialog").getByText("Export HTML", { exact: true }).click()
    expect((await commandDownload).suggestedFilename()).toMatch(/\.html$/)

    await page.getByRole("button", { name: "View context usage", exact: true }).click()
    const contextDownload = page.waitForEvent("download")
    await page.getByRole("button", { name: "Export HTML", exact: true }).click()
    expect((await contextDownload).suggestedFilename()).toMatch(/\.html$/)
  })
}

test("Chinese HTML export labels are loaded by the shared app language context", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    pageMessages: () => ({ items: fixture.messages[fixture.targetID].slice(-6) }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "zh" }))
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await installStressSessionTabs(page, { sessionIDs: [fixture.targetID] })
  await page.goto(stressSessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await page.getByRole("button", { name: "更多选项", exact: true }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: /^导出 HTML/ }).click()
  const saved = await download
  const html = await readFile((await saved.path())!, "utf8")
  expect(html).toContain('"download":"下载原始 JSON"')
})
