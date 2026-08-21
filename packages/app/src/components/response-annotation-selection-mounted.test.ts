import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url"
import { build } from "vite"

type Checks = typeof import("./response-annotation-selection.fixture")

let directory = ""
let checks: Checks

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "app-response-annotation-selection-"))
  const require = createRequire(new URL("../../../ui/package.json", import.meta.url))
  const DomURL = globalThis.URL
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document")
  Object.defineProperty(globalThis, "URL", { configurable: true, writable: true, value: NodeURL })
  Reflect.deleteProperty(globalThis, "document")
  try {
    const solid = await import(pathToFileURL(require.resolve("vite-plugin-solid")).href)
    await build({
      configFile: false,
      plugins: [solid.default({ hot: false })],
      resolve: {
        alias: [{ find: "@", replacement: fileURLToPath(new URL("..", import.meta.url)) }],
      },
      build: {
        emptyOutDir: true,
        minify: false,
        outDir: directory,
        lib: {
          entry: fileURLToPath(new URL("./response-annotation-selection.fixture.tsx", import.meta.url)),
          formats: ["es"],
          fileName: "checks",
        },
      },
    })
  } finally {
    Object.defineProperty(globalThis, "URL", { configurable: true, writable: true, value: DomURL })
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor)
  }
  checks = (await import(`${pathToFileURL(path.join(directory, "checks.js")).href}?run=${Date.now()}`)) as Checks
}, 30_000)

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  globalThis.document?.body.replaceChildren()
})

describe("response annotation selection integration", () => {
  test("shows the add annotation action for selected completed assistant text", async () => {
    await checks.selectionActionCheck()
    expect(document.querySelector('[data-component="response-annotation-selection-action"]')).toBeNull()
  })

  test("shows the add annotation action when the timeline root is bound after mount", async () => {
    await checks.selectionActionCheck({ lateRoot: true })
    expect(document.querySelector('[data-component="response-annotation-selection-action"]')).toBeNull()
  })

  test("shows the add annotation action when selection settles on mouseup", async () => {
    await checks.selectionActionCheck({ trigger: "mouseup" })
    expect(document.querySelector('[data-component="response-annotation-selection-action"]')).toBeNull()
  })

  test("focuses the add action after keyboard selection", async () => {
    await checks.selectionActionCheck({ keyboard: true, cancel: true })
    expect(document.querySelector('[data-component="response-annotation-selection-action"]')).toBeNull()
  })

  test("waits for pointer release and positions the action fully above the selected text", async () => {
    await checks.selectionReleasePositionCheck()
    expect(document.querySelector('[data-component="response-annotation-selection-action"]')).toBeNull()
  })

  test("cancels the anchored editor without creating a draft", async () => {
    await checks.selectionActionCheck({ cancel: true })
    expect(document.querySelector('[data-component="response-annotation-selection-editor"]')).toBeNull()
  })

  test("uses the compact Codex editor surface without voice input", async () => {
    await checks.selectionActionCheck({ presentation: true, cancel: true })
    expect(document.querySelector('[data-component="response-annotation-selection-editor"]')).toBeNull()
  })

  test("keeps the selected source highlighted while the new comment editor is open", async () => {
    await checks.selectionEditingHighlightCheck()
    expect(document.querySelector("[data-response-annotation-highlight-overlay]")).toBeNull()
  })

  test("restores the selected source after an annotation directive is replaced by interactive UI", async () => {
    await checks.replacedDirectiveSelectionMarkerCheck()
    expect(document.querySelector("[data-response-annotation-highlight-overlay]")).toBeNull()
  })

  test("shows numbered draft badges and opens the matching draft editor from a badge", async () => {
    await checks.pendingAnnotationBadgeCheck()
    expect(document.querySelector('[data-component="response-annotation-source-badge"]')).toBeNull()
  })

  test("repositions on scroll and closes when the virtualized source disappears", async () => {
    await checks.editorRepositionAndInvalidSourceCheck()
    expect(document.querySelector('[data-component="response-annotation-selection-editor"]')).toBeNull()
  })
})
