import { describe, expect, test } from "bun:test"
import { layoutPixelText, renderTerminalPixelText } from "../src"

describe("pixel font", () => {
  test("lays out arbitrary supported product names", () => {
    const layout = layoutPixelText("A1")

    expect(layout.width).toBe(9)
    expect(layout.height).toBe(5)
    expect(layout.cells.some((cell) => cell.character === 0)).toBe(true)
    expect(layout.cells.some((cell) => cell.character === 1)).toBe(true)
  })

  test("renders a terminal wordmark from the supplied name", () => {
    expect(renderTerminalPixelText("A1")).toEqual(["▄▀▀▄  ▄█ ", "█▀▀█   █ ", "▀  ▀  ▀▀▀"])
  })
})
