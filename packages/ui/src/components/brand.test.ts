import { describe, expect, test } from "bun:test"
import path from "path"
import { Brand } from "@opencode-ai/brand"

describe("UI brand contract", () => {
  test("renders both SVG wordmarks from Brand.name", async () => {
    const logo = await Bun.file(path.join(import.meta.dir, "logo.tsx")).text()
    const wordmark = await Bun.file(path.join(import.meta.dir, "../v2/components/wordmark-v2.tsx")).text()

    expect(logo).toContain("layoutPixelText(Brand.name)")
    expect(wordmark).toContain("layoutPixelText(Brand.name)")
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
