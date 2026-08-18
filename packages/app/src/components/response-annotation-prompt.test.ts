import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url"
import { build } from "vite"

type Checks = typeof import("./response-annotation-prompt.fixture")

let directory = ""
let checks: Checks

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "app-response-annotation-prompt-"))
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
        alias: [
          ...[
            "@/context/sdk",
            "@/context/sync",
            "@/context/file",
            "@/context/layout",
            "@/context/comments",
            "@/context/command",
            "@/context/permission",
            "@/context/language",
            "@/context/platform",
            "@/pages/session/helpers",
            "@/components/prompt-input/submit",
            "@/components/prompt-input/history-store",
            "@/utils/toast",
            "@/components/dialog-select-model",
            "@/components/dialog-select-model-unpaid",
            "@/components/dialog-select-model-unpaid-v2",
            "@opencode-ai/ui/context/dialog",
          ].map((find) => ({
            find: new RegExp(`^${find.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`),
            replacement: fileURLToPath(new URL("./response-annotation-prompt.mocks.ts", import.meta.url)),
          })),
          { find: "@", replacement: fileURLToPath(new URL("..", import.meta.url)) },
        ],
      },
      build: {
        emptyOutDir: true,
        minify: false,
        outDir: directory,
        lib: {
          entry: fileURLToPath(new URL("./response-annotation-prompt.fixture.tsx", import.meta.url)),
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

describe("response annotation prompt integration", () => {
  test("keeps V1 and V2 count, details, edits, and deletes in the same prompt state", async () => {
    await checks.promptIntegrationCheck()
    expect(document.querySelector("#v1")).toBeNull()
  })
})
