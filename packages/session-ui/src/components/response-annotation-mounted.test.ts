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
  test("focuses the editor on edit", async () => {
    await checks.editorFocusCheck()
    expect(document.body.childElementCount).toBe(0)
  })

  test("opens and closes hover details without stealing focus", async () => {
    await checks.hoverInteractionCheck()
    expect(document.body.childElementCount).toBe(0)
  })

  test("opens from an activated trigger and restores focus on Escape", async () => {
    await checks.keyboardInteractionCheck()
    expect(document.body.childElementCount).toBe(0)
  })

  test("does not mount ordinary fragment links or raw anchors", () => {
    checks.provenanceCheck()
    expect(document.body.childElementCount).toBe(0)
  })

  test("forwards a reference source action to the App timeline", () => {
    checks.sourceNavigationCheck()
    expect(document.body.childElementCount).toBe(0)
  })

  test("hides a reference source action when the Assistant source is unavailable", () => {
    checks.unavailableSourceNavigationCheck()
    expect(document.body.childElementCount).toBe(0)
  })
})
