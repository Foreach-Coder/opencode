import { describe, expect, test } from "bun:test"
import path from "path"
import { Brand, renderTerminalPixelText } from "@opencode-ai/brand"
import { logo, wordmark } from "../src/logo"

describe("TUI brand contract", () => {
  test("derives the wordmark from an arbitrary name", () => {
    expect(wordmark("A1").full.slice(1)).toEqual(renderTerminalPixelText("A1"))
    expect(logo.full.slice(1)).toEqual(renderTerminalPixelText(Brand.name))
  })

  test("does not hardcode the current product name in runtime TypeScript", async () => {
    const root = path.join(import.meta.dir, "../src")
    const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, absolute: true }))
    const hits = (
      await Promise.all(
        files.map(async (file) => ((await Bun.file(file).text()).includes(Brand.name) ? file : undefined)),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })
})
