import { describe, expect, test } from "bun:test"
import path from "path"
import { Brand } from "@opencode-ai/brand"

describe("UI brand contract", () => {
  test("renders both SVG wordmarks only from the required compile-time visual asset", async () => {
    const logo = await Bun.file(path.join(import.meta.dir, "logo.tsx")).text()
    const wordmark = await Bun.file(path.join(import.meta.dir, "../v2/components/wordmark-v2.tsx")).text()

    expect(logo).toContain("VisualAssets.wordmark")
    expect(wordmark).toContain("VisualAssets.wordmark")
    expect(logo).not.toContain("layoutPixelText")
    expect(wordmark).not.toContain("layoutPixelText")
    expect(logo).toContain("<image")
    expect(wordmark).toContain("<image")
    expect(logo).toContain('fill="currentColor"')
    expect(wordmark).toContain('fill="currentColor"')
    expect(logo).toContain("usesCurrentColor")
    expect(wordmark).toContain("usesCurrentColor")
    expect(logo).toContain('"mask-type": "alpha"')
    expect(wordmark).toContain('"mask-type": "alpha"')
    expect(logo).not.toContain("innerHTML")
    expect(wordmark).not.toContain("innerHTML")
  })

  test("uses the compile-time App Icon in the browser favicon component", async () => {
    const favicon = await Bun.file(path.join(import.meta.dir, "favicon.tsx")).text()
    const logo = await Bun.file(path.join(import.meta.dir, "logo.tsx")).text()

    expect(favicon).toContain("VisualAssets.appIcon")
    expect(favicon).toContain("dataUri")
    expect(logo.match(/VisualAssets\.appIcon/g)?.length).toBeGreaterThanOrEqual(4)
    expect(logo).toContain("VisualAssets.appIcon.dataUri")
  })

  test("uses the compile-time App Icon for Web and Desktop notifications", async () => {
    const app = await Bun.file(path.resolve(import.meta.dir, "../../../app/src/entry.tsx")).text()
    const desktop = await Bun.file(path.resolve(import.meta.dir, "../../../desktop/src/renderer/index.tsx")).text()

    expect(app).toContain("VisualAssets.appIcon.dataUri")
    expect(desktop).toContain("VisualAssets.appIcon.dataUri")
    expect(app).not.toContain("favicon-v3.svg")
    expect(desktop).not.toContain("favicon-v3.svg")
  })

  test("does not hardcode the current product name in runtime TypeScript", async () => {
    const root = path.join(import.meta.dir, "..")
    const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, absolute: true }))
    const hits = (
      await Promise.all(
        files.map(async (file) =>
          !file.endsWith(".test.ts") && (await Bun.file(file).text()).includes(Brand.name) ? file : undefined,
        ),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })
})
