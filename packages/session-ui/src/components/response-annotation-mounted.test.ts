import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"

type Checks = typeof import("./response-annotation-mounted.fixture")

let directory = ""
let checks: Checks

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "session-ui-mounted-"))
  const require = createRequire(new URL("../../../ui/package.json", import.meta.url))
  const solid = await import(pathToFileURL(require.resolve("vite-plugin-solid")).href)
  await build({
    configFile: false,
    plugins: [solid.default({ hot: false })],
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: directory,
      lib: {
        entry: fileURLToPath(new URL("./response-annotation-mounted.fixture.tsx", import.meta.url)),
        formats: ["es"],
        fileName: "checks",
      },
    },
  })
  await import("../../../app/happydom")
  checks = (await import(`${pathToFileURL(path.join(directory, "checks.js")).href}?run=${Date.now()}`)) as Checks
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  document.body.replaceChildren()
})

describe("response annotation mounted behavior", () => {
  const expectNoMountedUi = () => {
    expect([...document.body.children].filter((element) => element.id !== "opencode-icon-sprite")).toEqual([])
  }

  test("focuses the editor on edit", async () => {
    await checks.editorFocusCheck()
    expectNoMountedUi()
  })

  test("opens and closes hover details without stealing focus", async () => {
    await checks.hoverInteractionCheck()
    expectNoMountedUi()
  })

  test("renders a link-like reference and portals complete hover details", async () => {
    await checks.referencePresentationCheck()
    expectNoMountedUi()
  })

  test("shows details on keyboard focus without button activation", async () => {
    await checks.keyboardInteractionCheck()
    expectNoMountedUi()
  })

  test("collapses historical annotations into one count trigger", async () => {
    await checks.historySummaryCheck()
    expectNoMountedUi()
  })

  test("shows historical annotation details only while focused", async () => {
    await checks.historyFocusCheck()
    expectNoMountedUi()
  })

  test("does not mount ordinary fragment links or raw anchors", () => {
    checks.provenanceCheck()
    expectNoMountedUi()
  })

  test("does not expose a click dialog or source action", () => {
    checks.noClickActionCheck()
    expectNoMountedUi()
  })
})
