import { describe, expect, test } from "bun:test"
import path from "path"
import { Brand, renderTerminalPixelText } from "@opencode-ai/brand"
import { VisualAssets } from "@opencode-ai/brand/assets"
import { gridWordmark, logo, wordmark } from "../src/logo"

describe("TUI brand contract", () => {
  test("uses an explicit grid for the product logo and can render arbitrary names", () => {
    expect(wordmark("A1").full.slice(1)).toEqual(renderTerminalPixelText("A1"))
    expect(logo).toEqual(gridWordmark(VisualAssets.tuiWordmarkGrid))
  })

  test("renders a validated custom TUI grid through the shared wordmark shape", () => {
    expect(
      gridWordmark({
        width: 3,
        height: 3,
        cells: [
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 0],
        ],
      }),
    ).toEqual({
      full: ["   ", "█▄█", " ▀ "],
      left: ["   ", "█▄█", " ▀ "],
      right: ["", "", ""],
    })
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
